import { DatabaseSync } from "node:sqlite";
import { ethers } from "ethers";
import { Chain } from "../../src/chain.js";

const db = new DatabaseSync("./fairseat.db");
const p = db.prepare("SELECT * FROM pending_creations WHERE matched=0 ORDER BY id DESC LIMIT 1").get() as any;
if (!p) { console.log("No unmatched pending creation — did you run /giveaway in the group?"); process.exit(1); }
console.log("Pending giveaway:", {
  prize: ethers.formatEther(BigInt(p.prize_wei)) + " tBNB", winners: p.winner_count,
  rule: p.rule, entry_mode: p.entry_mode, scope: p.scope, draw_block: p.draw_block, host: p.host_wallet,
});
const chain = new Chain();
const value = p.token === ethers.ZeroAddress ? BigInt(p.prize_wei) : 0n;
const tx = await chain.vault.createGiveaway(p.token, BigInt(p.prize_wei), p.winner_count, p.rule, p.entry_mode, p.draw_block, { value });
console.log("createGiveaway tx:", tx.hash);
await tx.wait();
console.log("Funded + locked. The bot's watcher will post the giveaway in your group shortly.");
db.close();
