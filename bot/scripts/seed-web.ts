import { ethers } from "ethers";
import { FairSeatDB } from "../src/db.js";
import { Chain } from "../src/chain.js";
import { Service } from "../src/service.js";

// Seed a few public giveaways on testnet so the website has content (funds from the operator).
const db = new FairSeatDB(process.env.DB_PATH || "./fairseat.db");
const chain = new Chain();
const svc = new Service(db, chain);
const host = chain.operator!.address;

const specs = [
  { amount: "0.0002", winners: 1, rule: 1, dur: 7200 },
  { amount: "0.0001", winners: 2, rule: 0, dur: 1800 },
  { amount: "0.00015", winners: 3, rule: 2, dur: 3600 },
];

for (const s of specs) {
  const prize = ethers.parseEther(s.amount);
  const prep = await svc.prepareGiveaway({
    creatorIdentity: "web:seed", hostWallet: host, chatId: 0, token: ethers.ZeroAddress,
    prizeWei: prize, winnerCount: s.winners, rule: s.rule, entryMode: 0, scope: "public",
    accessKey: null, durationSeconds: s.dur,
  });
  if ("error" in prep) {
    console.log("skip:", prep.error);
    continue;
  }
  const tx = await chain.vault.createGiveaway(ethers.ZeroAddress, prize, s.winners, s.rule, 0, prep.drawBlock, { value: prize });
  console.log(`funded ${s.amount} (rule ${s.rule}) tx ${tx.hash}`);
  await tx.wait();
}
console.log("seeded — the running watcher will record them shortly");
db.close();
