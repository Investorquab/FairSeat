// Live test: point the watcher at BSC testnet, send a real verify tx, confirm it binds.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ethers } from "ethers";
import { FairSeatDB } from "../../src/db.js";
import { Chain } from "../../src/chain.js";
import { Service } from "../../src/service.js";
import { Watcher, type Notifier } from "../../src/watcher.js";
import { config } from "../../src/config.js";

async function main() {
  const db = new FairSeatDB(join(tmpdir(), `fairseat-live-${Date.now()}.db`));
  const chain = new Chain();
  const svc = new Service(db, chain);

  const tid = 424242;
  const amount = svc.startVerification(tid).amountWei!;
  console.log(`Verify amount: ${ethers.formatEther(amount)} ${config.nativeSymbol} → ${config.verifierAddress}`);

  let bound: string | null = null;
  const notifier: Notifier = {
    async onVerified(telegramId, wallet) {
      if (telegramId === tid) {
        bound = wallet;
        console.log(`✅ WATCHER detected Verified → bound tg:${telegramId} ↔ ${wallet}`);
      }
    },
    async onGiveawayLive() {},
    async onResolved() {},
  };

  const watcher = new Watcher(chain, svc, notifier);
  const from = await chain.blockNumber();
  await watcher.start(Math.max(0, from - 2));

  const tx = await chain.operator!.sendTransaction({ to: config.verifierAddress, value: amount });
  console.log(`Sent verify tx ${tx.hash}`);
  await tx.wait();

  const t0 = Date.now();
  while (!bound && Date.now() - t0 < 90_000) await new Promise((r) => setTimeout(r, 2000));
  watcher.stop();

  if (bound) {
    console.log(`SUCCESS - db binding: tg:${tid} ↔ ${svc.walletOf(tid)}`);
  } else {
    console.log("TIMEOUT - watcher did not bind");
    process.exitCode = 1;
  }
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
