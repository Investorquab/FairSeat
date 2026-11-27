import { DatabaseSync } from "node:sqlite";
import { ethers } from "ethers";
import { Chain } from "../../src/chain.js";
import { config } from "../../src/config.js";

const db = new DatabaseSync("./fairseat.db");
const row = db.prepare("SELECT * FROM verify_sessions WHERE status='pending' ORDER BY id DESC LIMIT 1").get() as any;
if (!row) { console.log("No pending verify session found - did you send /verify?"); process.exit(1); }
console.log(`Pending session: ${row.identity}, amount ${ethers.formatEther(BigInt(row.amount_wei))} tBNB`);
const chain = new Chain();
const tx = await chain.operator!.sendTransaction({ to: config.verifierAddress, value: BigInt(row.amount_wei) });
console.log("Sent verify tx:", tx.hash);
await tx.wait();
console.log("Confirmed. The running bot's watcher should now bind and DM the user.");
db.close();
