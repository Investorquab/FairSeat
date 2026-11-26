import { config, assertChainConfig } from "./config.js";
import { FairSeatDB } from "./db.js";
import { Chain } from "./chain.js";
import { Service } from "./service.js";
import { Watcher, type Notifier } from "./watcher.js";
import { createBot } from "./bot.js";
import { startApi } from "./api.js";

// Web users get updates by polling the API, so a no-op notifier is fine when there's no bot.
const noopNotifier: Notifier = {
  async onVerified() {},
  async onGiveawayLive() {},
  async onResolved() {},
};

async function main(): Promise<void> {
  assertChainConfig();

  const db = new FairSeatDB(config.dbPath);
  const chain = new Chain();
  const service = new Service(db, chain);

  let notifier: Notifier = noopNotifier;
  let bot: ReturnType<typeof createBot>["bot"] | undefined;
  if (config.botToken) {
    const b = createBot(service, chain);
    bot = b.bot;
    notifier = b.notifier;
  }

  const watcher = new Watcher(chain, service, notifier);
  await watcher.start();
  console.log(`FairSeat watcher started (chain ${config.chainId}). Verifier ${config.verifierAddress}, vault ${config.vaultAddress}`);

  const apiPort = Number(process.env.API_PORT ?? 8787);
  startApi(service, apiPort);

  if (bot) {
    bot.catch((err) => console.error("[bot] error:", err.error));
    console.log("FairSeat bot starting…");
    await bot.start();
  } else {
    console.log("No BOT_TOKEN set — running API + watcher only (no Telegram).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
