import { config, assertChainConfig } from "./config.js";
import { FairSeatDB } from "./db.js";
import { Chain } from "./chain.js";
import { Service } from "./service.js";
import { Watcher } from "./watcher.js";
import { createBot } from "./bot.js";

async function main(): Promise<void> {
  assertChainConfig();
  if (!config.botToken) throw new Error("BOT_TOKEN is missing — set it in .env");

  const db = new FairSeatDB(config.dbPath);
  const chain = new Chain();
  const service = new Service(db, chain);
  const { bot, notifier } = createBot(service, chain);
  const watcher = new Watcher(chain, service, notifier);

  await watcher.start();
  console.log(`FairSeat watcher started (chain ${config.chainId}). Verifier ${config.verifierAddress}, vault ${config.vaultAddress}`);

  bot.catch((err) => console.error("[bot] error:", err.error));
  console.log("FairSeat bot starting…");
  await bot.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
