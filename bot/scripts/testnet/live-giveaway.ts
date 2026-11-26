// Live test of the full giveaway orchestration against BSC testnet:
// host funds on-chain -> watcher announces -> entrants tap -> scheduler commits + resolves
// -> Resolved handler maps the winner. No grammY; the watcher + service drive everything.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ethers } from "ethers";
import { FairSeatDB } from "../../src/db.js";
import { Chain } from "../../src/chain.js";
import { Service, Rule, EntryMode } from "../../src/service.js";
import { Watcher, type Notifier } from "../../src/watcher.js";
import { config } from "../../src/config.js";

async function main() {
  const db = new FairSeatDB(join(tmpdir(), `fairseat-ga-${Date.now()}.db`));
  const chain = new Chain();
  const svc = new Service(db, chain);
  const op = chain.operator!;

  // Mock-registry handle so we can grant Agent IDs to test entrants.
  const registry = new ethers.Contract(config.registryAddress, ["function assign(address) returns (uint256)", "function balanceOf(address) view returns (uint256)"], op);

  // Host = deployer (already holds an Agent ID).
  const hostTid = 1;
  svc.handleVerified(op.address, svc.startVerification(hostTid).amountWei!);

  // Two test entrants.
  const w1 = ethers.Wallet.createRandom().address;
  const w2 = ethers.Wallet.createRandom().address;
  for (const w of [w1, w2]) {
    if ((await registry.balanceOf(w)) === 0n) await (await registry.assign(w)).wait();
  }
  svc.handleVerified(w1, svc.startVerification(101).amountWei!);
  svc.handleVerified(w2, svc.startVerification(102).amountWei!);

  let liveGiveawayId: number | null = null;
  let resolvedWinner: { address: string; telegramId?: number } | null = null;
  const notifier: Notifier = {
    async onVerified() {},
    async onGiveawayLive(g) {
      liveGiveawayId = g.id;
      console.log(`📣 onGiveawayLive #${g.id} (scope ${g.scope}, ${g.winner_count} winner, prize ${ethers.formatEther(g.prize_wei)} ${config.nativeSymbol})`);
    },
    async onResolved(info, seed, txHash) {
      resolvedWinner = info.winners[0] ?? null;
      console.log(`🏆 onResolved #${info.giveaway.id}: winner ${info.winners.map((w) => `${w.address}${w.telegramId ? ` (tg:${w.telegramId})` : ""}`).join(", ") || "none"}`);
      console.log(`   seed ${seed.slice(0, 18)}…  tx ${config.explorer}/tx/${txHash}`);
    },
  };

  const watcher = new Watcher(chain, svc, notifier);
  await watcher.start(Math.max(0, (await chain.blockNumber()) - 2));

  // Host prepares + funds the giveaway (short duration so the draw comes quickly).
  const prep = await svc.prepareGiveaway({
    creatorTelegramId: hostTid, chatId: -1001, token: ethers.ZeroAddress, prizeWei: ethers.parseEther("0.00005"),
    winnerCount: 1, rule: Rule.Random, entryMode: EntryMode.OffChainTap, scope: "public", accessKey: null, durationSeconds: 30,
  });
  if ("error" in prep) throw new Error(prep.error);
  console.log(`Funding giveaway (drawBlock ${prep.drawBlock})…`);
  const tx = await op.sendTransaction({ to: prep.tx.to, value: BigInt(prep.tx.value), data: prep.tx.data });
  await tx.wait();
  console.log(`Funded: ${config.explorer}/tx/${tx.hash}`);

  // Wait for the watcher to see GiveawayCreated.
  let t0 = Date.now();
  while (liveGiveawayId === null && Date.now() - t0 < 60_000) await new Promise((r) => setTimeout(r, 2000));
  if (liveGiveawayId === null) throw new Error("giveaway not detected");

  // Entrants tap in.
  console.log("Entrants tapping in…");
  console.log("  w1:", await svc.enterGiveaway(liveGiveawayId, 101, { membershipOk: true }));
  console.log("  w2:", await svc.enterGiveaway(liveGiveawayId, 102, { membershipOk: true }));

  // Wait for the scheduler to commit + resolve.
  t0 = Date.now();
  while (resolvedWinner === null && Date.now() - t0 < 150_000) await new Promise((r) => setTimeout(r, 2500));
  watcher.stop();

  if (resolvedWinner) {
    const won = resolvedWinner as { address: string; telegramId?: number };
    const isEntrant = [w1.toLowerCase(), w2.toLowerCase()].includes(won.address.toLowerCase());
    console.log(`\nSUCCESS — winner ${won.address} (tg:${won.telegramId}) is one of the entrants: ${isEntrant}`);
    if (!isEntrant || !won.telegramId) process.exitCode = 1;
  } else {
    console.log("TIMEOUT — no resolution");
    process.exitCode = 1;
  }
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
