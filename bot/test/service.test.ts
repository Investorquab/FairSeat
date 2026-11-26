import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { ethers } from "ethers";
import { FairSeatDB } from "../src/db.js";
import { Service, Rule, EntryMode, VoteMode } from "../src/service.js";
import type { Chain } from "../src/chain.js";

// A deterministic fake chain so service logic is tested without any network.
class FakeChain {
  block = 1000;
  async blockNumber() {
    return this.block;
  }
  async holdsAgentId() {
    return true;
  }
  encodeCreateGiveaway(token: string, prizeWei: bigint) {
    return { to: "0xVault", value: token === ethers.ZeroAddress ? prizeWei.toString() : "0", data: "0xdata" };
  }
  encodeCreatePoll() {
    return { to: "0xPoll", value: "0", data: "0xpoll" };
  }
  async commitVotes() {
    return "0xvotes";
  }
  async commitEntrants() {
    return "0xcommit";
  }
  async resolve() {
    return "0xresolve";
  }
}

function freshDb() {
  const path = join(tmpdir(), `fairseat-test-${Math.random().toString(36).slice(2)}.db`);
  return { db: new FairSeatDB(path), path };
}

const WALLET_A = ethers.getAddress("0x00000000000000000000000000000000000000a1");
const WALLET_B = ethers.getAddress("0x00000000000000000000000000000000000000b2");
const HOST = "tg:1";
const USER = "tg:2";
const WEB = "web:abc123";

test("verify flow works for both telegram and web identities", () => {
  const { db, path } = freshDb();
  const svc = new Service(db, new FakeChain() as unknown as Chain);

  const amount = svc.startVerification(WEB).amountWei!;
  const match = svc.handleVerified(WALLET_A, amount);
  assert.ok(match);
  assert.equal(match!.identity, WEB);
  assert.equal(svc.walletOf(WEB), WALLET_A);
  assert.equal(svc.startVerification(WEB).alreadyVerified, true);

  db.close();
  rmSync(path, { force: true });
});

test("verify: unknown amount does not bind anyone", () => {
  const { db, path } = freshDb();
  const svc = new Service(db, new FakeChain() as unknown as Chain);
  svc.startVerification("tg:222");
  assert.equal(svc.handleVerified(WALLET_A, ethers.parseEther("0.5")), null);
  db.close();
  rmSync(path, { force: true });
});

test("create → GiveawayCreated links back to the pending config", async () => {
  const { db, path } = freshDb();
  const svc = new Service(db, new FakeChain() as unknown as Chain);
  svc.handleVerified(WALLET_A, svc.startVerification(HOST).amountWei!);

  const prep = await svc.prepareGiveaway({
    creatorIdentity: HOST, hostWallet: WALLET_A, chatId: -100, token: ethers.ZeroAddress, prizeWei: ethers.parseEther("1"),
    winnerCount: 2, rule: Rule.Random, entryMode: EntryMode.OffChainTap, scope: "public", accessKey: null, durationSeconds: 3600,
  });
  assert.ok(!("error" in prep));
  const drawBlock = (prep as { drawBlock: number }).drawBlock;

  const g = svc.handleGiveawayCreated({
    id: 1, host: WALLET_A, token: ethers.ZeroAddress, prize: ethers.parseEther("1"),
    winnerCount: 2, rule: Rule.Random, entryMode: EntryMode.OffChainTap, drawBlock,
  });
  assert.ok(g);
  assert.equal(g!.id, 1);
  assert.equal(g!.scope, "public");
  assert.equal(g!.creator_identity, HOST);
  db.close();
  rmSync(path, { force: true });
});

test("entry gates: verified required, dedupe, scope, access key", async () => {
  const { db, path } = freshDb();
  const svc = new Service(db, new FakeChain() as unknown as Chain);

  svc.handleVerified(WALLET_A, svc.startVerification(HOST).amountWei!);
  const prep = await svc.prepareGiveaway({
    creatorIdentity: HOST, hostWallet: WALLET_A, chatId: -100, token: ethers.ZeroAddress, prizeWei: ethers.parseEther("1"),
    winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, scope: "public", accessKey: null, durationSeconds: 3600,
  });
  const drawBlock = (prep as { drawBlock: number }).drawBlock;
  svc.handleGiveawayCreated({ id: 1, host: WALLET_A, token: ethers.ZeroAddress, prize: ethers.parseEther("1"), winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, drawBlock });

  assert.deepEqual(await svc.enterGiveaway(1, "tg:999", { membershipOk: true }), { ok: false, reason: "not_verified" });

  svc.handleVerified(WALLET_B, svc.startVerification(USER).amountWei!);
  assert.deepEqual(await svc.enterGiveaway(1, USER, { membershipOk: true }), { ok: true, mode: "tap" });
  assert.deepEqual(await svc.enterGiveaway(1, USER, { membershipOk: true }), { ok: false, reason: "already" });

  const prep2 = await svc.prepareGiveaway({
    creatorIdentity: HOST, hostWallet: WALLET_A, chatId: -100, token: ethers.ZeroAddress, prizeWei: ethers.parseEther("1"),
    winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, scope: "private", accessKey: "SECRET", durationSeconds: 3600,
  });
  const draw2 = (prep2 as { drawBlock: number }).drawBlock;
  svc.handleGiveawayCreated({ id: 2, host: WALLET_A, token: ethers.ZeroAddress, prize: ethers.parseEther("1"), winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, drawBlock: draw2 });
  assert.deepEqual(await svc.enterGiveaway(2, USER, { membershipOk: true, providedKey: "nope" }), { ok: false, reason: "wrong_key" });
  assert.deepEqual(await svc.enterGiveaway(2, USER, { membershipOk: true, providedKey: "SECRET" }), { ok: true, mode: "tap" });

  db.close();
  rmSync(path, { force: true });
});

test("entries close by wall clock", async () => {
  const { db, path } = freshDb();
  const svc = new Service(db, new FakeChain() as unknown as Chain);
  svc.handleVerified(WALLET_A, svc.startVerification(HOST).amountWei!);
  const prep = await svc.prepareGiveaway({
    creatorIdentity: HOST, hostWallet: WALLET_A, chatId: -100, token: ethers.ZeroAddress, prizeWei: ethers.parseEther("1"),
    winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, scope: "public", accessKey: null, durationSeconds: 0,
  });
  const drawBlock = (prep as { drawBlock: number }).drawBlock;
  svc.handleGiveawayCreated({ id: 1, host: WALLET_A, token: ethers.ZeroAddress, prize: ethers.parseEther("1"), winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, drawBlock });

  svc.handleVerified(WALLET_B, svc.startVerification(USER).amountWei!);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await svc.enterGiveaway(1, USER, { membershipOk: true }), { ok: false, reason: "closed" });
  db.close();
  rmSync(path, { force: true });
});

test("handleResolved maps winners to user identities", () => {
  const { db, path } = freshDb();
  const svc = new Service(db, new FakeChain() as unknown as Chain);
  svc.handleVerified(WALLET_A, svc.startVerification("tg:7").amountWei!);
  db.insertGiveaway({
    id: 5, chat_id: -100, creator_identity: "tg:7", token: ethers.ZeroAddress, prize_wei: ethers.parseEther("1").toString(),
    winner_count: 1, rule: Rule.Random, entry_mode: EntryMode.OffChainTap, scope: "public", access_key: null,
    entries_close_at: Date.now() + 100000, draw_block: 2000, created_at: Date.now(),
  });
  const info = svc.handleResolved(5, [WALLET_A], ethers.parseEther("1"), "0xseed", "0xtx");
  assert.ok(info);
  assert.equal(info!.winners[0].identity, "tg:7");
  assert.equal(info!.giveaway.status, "resolved");
  db.close();
  rmSync(path, { force: true });
});

test("poll: create → one Agent ID one vote (tap) → public tally", async () => {
  const { db, path } = freshDb();
  const svc = new Service(db, new FakeChain() as unknown as Chain);
  svc.handleVerified(WALLET_A, svc.startVerification("tg:10").amountWei!);
  svc.handleVerified(WALLET_B, svc.startVerification("tg:11").amountWei!);

  const prep = await svc.preparePoll({
    creatorIdentity: "tg:10", hostWallet: WALLET_A, chatId: -1, question: "Which next?",
    options: ["A", "B", "C"], mode: VoteMode.OffChainTap, durationSeconds: 3600,
  });
  assert.ok(!("error" in prep));
  const closeBlock = (prep as { closeBlock: number }).closeBlock;
  const poll = svc.handlePollCreated({ id: 1, host: WALLET_A, numOptions: 3, closeBlock, mode: VoteMode.OffChainTap });
  assert.ok(poll);

  assert.deepEqual(await svc.votePoll(1, "tg:10", 0), { ok: true, mode: "tap", option: 0 });
  assert.deepEqual(await svc.votePoll(1, "tg:11", 0), { ok: true, mode: "tap", option: 0 });
  assert.deepEqual(await svc.votePoll(1, "tg:10", 1), { ok: false, reason: "already" });
  assert.deepEqual(await svc.votePoll(1, "tg:999", 0), { ok: false, reason: "not_verified" });
  assert.deepEqual(await svc.votePoll(1, "tg:11", 9), { ok: false, reason: "bad_option" });

  const v = svc.pollView(1)!;
  assert.deepEqual(v.tally, [2, 0, 0]);
  assert.equal(v.totalVotes, 2);
  db.close();
  rmSync(path, { force: true });
});
