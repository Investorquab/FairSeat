import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { ethers } from "ethers";
import { FairSeatDB } from "../src/db.js";
import { Service, Rule, EntryMode } from "../src/service.js";
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

test("verify flow: session → Verified event binds the wallet", () => {
  const { db, path } = freshDb();
  const svc = new Service(db, new FakeChain() as unknown as Chain);
  const tid = 111;

  const start = svc.startVerification(tid);
  assert.equal(start.alreadyVerified, false);
  const amount = start.amountWei!;

  // simulate the on-chain Verified(account, amount) event
  const match = svc.handleVerified(WALLET_A, amount);
  assert.ok(match);
  assert.equal(match!.telegramId, tid);
  assert.equal(svc.walletOf(tid), WALLET_A);

  // already verified now
  assert.equal(svc.startVerification(tid).alreadyVerified, true);
  db.close();
  rmSync(path, { force: true });
});

test("verify: unknown amount does not bind anyone", () => {
  const { db, path } = freshDb();
  const svc = new Service(db, new FakeChain() as unknown as Chain);
  svc.startVerification(222);
  const bogus = ethers.parseEther("0.5");
  assert.equal(svc.handleVerified(WALLET_A, bogus), null);
  db.close();
  rmSync(path, { force: true });
});

test("create → GiveawayCreated links back to the pending config", async () => {
  const { db, path } = freshDb();
  const chain = new FakeChain();
  const svc = new Service(db, chain as unknown as Chain);
  const host = 333;
  // verify the host
  const amt = svc.startVerification(host).amountWei!;
  svc.handleVerified(WALLET_A, amt);

  const prep = await svc.prepareGiveaway({
    creatorTelegramId: host,
    chatId: -100,
    token: ethers.ZeroAddress,
    prizeWei: ethers.parseEther("1"),
    winnerCount: 2,
    rule: Rule.Random,
    entryMode: EntryMode.OffChainTap,
    scope: "public",
    accessKey: null,
    durationSeconds: 3600,
  });
  assert.ok(!("error" in prep));
  const drawBlock = (prep as { drawBlock: number }).drawBlock;

  // simulate GiveawayCreated with the host's wallet + matching params
  const g = svc.handleGiveawayCreated({
    id: 1, host: WALLET_A, token: ethers.ZeroAddress, prize: ethers.parseEther("1"),
    winnerCount: 2, rule: Rule.Random, entryMode: EntryMode.OffChainTap, drawBlock,
  });
  assert.ok(g);
  assert.equal(g!.id, 1);
  assert.equal(g!.scope, "public");
  db.close();
  rmSync(path, { force: true });
});

test("entry gates: verified required, dedupe, scope, access key", async () => {
  const { db, path } = freshDb();
  const chain = new FakeChain();
  const svc = new Service(db, chain as unknown as Chain);

  // host + giveaway (public, tap)
  const host = 1;
  svc.handleVerified(WALLET_A, svc.startVerification(host).amountWei!);
  const prep = await svc.prepareGiveaway({
    creatorTelegramId: host, chatId: -100, token: ethers.ZeroAddress, prizeWei: ethers.parseEther("1"),
    winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, scope: "public", accessKey: null, durationSeconds: 3600,
  });
  const drawBlock = (prep as { drawBlock: number }).drawBlock;
  svc.handleGiveawayCreated({ id: 1, host: WALLET_A, token: ethers.ZeroAddress, prize: ethers.parseEther("1"), winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, drawBlock });

  // unverified entrant
  assert.deepEqual(await svc.enterGiveaway(1, 999, { membershipOk: true }), { ok: false, reason: "not_verified" });

  // verified entrant can enter once
  svc.handleVerified(WALLET_B, svc.startVerification(2).amountWei!);
  assert.deepEqual(await svc.enterGiveaway(1, 2, { membershipOk: true }), { ok: true, mode: "tap" });
  assert.deepEqual(await svc.enterGiveaway(1, 2, { membershipOk: true }), { ok: false, reason: "already" });

  // private giveaway needs the key
  const prep2 = await svc.prepareGiveaway({
    creatorTelegramId: host, chatId: -100, token: ethers.ZeroAddress, prizeWei: ethers.parseEther("1"),
    winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, scope: "private", accessKey: "SECRET", durationSeconds: 3600,
  });
  const draw2 = (prep2 as { drawBlock: number }).drawBlock;
  svc.handleGiveawayCreated({ id: 2, host: WALLET_A, token: ethers.ZeroAddress, prize: ethers.parseEther("1"), winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, drawBlock: draw2 });
  assert.deepEqual(await svc.enterGiveaway(2, 2, { membershipOk: true, providedKey: "nope" }), { ok: false, reason: "wrong_key" });
  assert.deepEqual(await svc.enterGiveaway(2, 2, { membershipOk: true, providedKey: "SECRET" }), { ok: true, mode: "tap" });

  db.close();
  rmSync(path, { force: true });
});

test("entries close by wall clock", async () => {
  const { db, path } = freshDb();
  const chain = new FakeChain();
  const svc = new Service(db, chain as unknown as Chain);
  const host = 1;
  svc.handleVerified(WALLET_A, svc.startVerification(host).amountWei!);
  const prep = await svc.prepareGiveaway({
    creatorTelegramId: host, chatId: -100, token: ethers.ZeroAddress, prizeWei: ethers.parseEther("1"),
    winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, scope: "public", accessKey: null, durationSeconds: 0,
  });
  const drawBlock = (prep as { drawBlock: number }).drawBlock;
  svc.handleGiveawayCreated({ id: 1, host: WALLET_A, token: ethers.ZeroAddress, prize: ethers.parseEther("1"), winnerCount: 1, rule: Rule.FirstN, entryMode: EntryMode.OffChainTap, drawBlock });

  svc.handleVerified(WALLET_B, svc.startVerification(2).amountWei!);
  await new Promise((r) => setTimeout(r, 5)); // let the 0s window elapse
  assert.deepEqual(await svc.enterGiveaway(1, 2, { membershipOk: true }), { ok: false, reason: "closed" });
  db.close();
  rmSync(path, { force: true });
});

test("handleResolved maps winners to telegram users", () => {
  const { db, path } = freshDb();
  const svc = new Service(db, new FakeChain() as unknown as Chain);
  svc.handleVerified(WALLET_A, svc.startVerification(7).amountWei!);
  // store a resolved-able giveaway row directly
  db.insertGiveaway({
    id: 5, chat_id: -100, creator_telegram_id: 7, token: ethers.ZeroAddress, prize_wei: ethers.parseEther("1").toString(),
    winner_count: 1, rule: Rule.Random, entry_mode: EntryMode.OffChainTap, scope: "public", access_key: null,
    entries_close_at: Date.now() + 100000, draw_block: 2000, created_at: Date.now(),
  });
  const info = svc.handleResolved(5, [WALLET_A], ethers.parseEther("1"));
  assert.ok(info);
  assert.equal(info!.winners[0].telegramId, 7);
  db.close();
  rmSync(path, { force: true });
});
