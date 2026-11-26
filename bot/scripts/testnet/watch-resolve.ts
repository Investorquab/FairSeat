import { DatabaseSync } from "node:sqlite";
import { ethers } from "ethers";
import { Chain } from "../../src/chain.js";
import { config } from "../../src/config.js";
const id = 5;
const db = new DatabaseSync("./fairseat.db");
const chain = new Chain();
const start = Date.now();
let status = "open";
while (Date.now() - start < 330000) {
  status = (db.prepare("SELECT status FROM giveaways WHERE id=?").get(id) as any)?.status;
  const committed = (db.prepare("SELECT committed FROM giveaways WHERE id=?").get(id) as any)?.committed;
  process.stdout.write(`\r[${Math.round((Date.now()-start)/1000)}s] status=${status} committed=${committed}   `);
  if (status === "resolved") break;
  await new Promise((r) => setTimeout(r, 12000));
}
console.log("");
const g: any = await chain.vault.getGiveaway(id);
console.log("on-chain state:", g.state.toString(), "(2=Resolved)");
const logs = await chain.vault.queryFilter(chain.vault.filters.Resolved(id), -8000);
if (logs.length) {
  const l: any = logs[logs.length - 1];
  console.log("WINNERS:", l.args.winners);
  console.log("perWinner:", ethers.formatEther(l.args.perWinner), config.nativeSymbol);
  console.log("seed:", l.args.seed);
  console.log("resolve tx:", `${config.explorer}/tx/${l.transactionHash}`);
}
db.close();
