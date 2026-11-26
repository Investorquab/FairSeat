import { ethers } from "ethers";
import { FairSeatDB } from "../../src/db.js";
import { Chain } from "../../src/chain.js";
import { Service, VoteMode } from "../../src/service.js";
const db = new FairSeatDB(process.env.DB_PATH || "./fairseat.db");
const chain = new Chain();
const svc = new Service(db, chain);
const host = chain.operator!.address;
const question = "Which should FairSeat build next?";
const options = ["Quadratic funding rounds", "A one-tap ‘Verify with FairSeat’ button", "Token-gated giveaways"];
const prep = await svc.preparePoll({ creatorIdentity: "web:seed", hostWallet: host, chatId: 0, question, options, mode: VoteMode.OffChainTap, durationSeconds: 7200 });
if ("error" in prep) throw new Error(prep.error);
const tx = await chain.poll.createPoll(options.length, prep.closeBlock, VoteMode.OffChainTap);
console.log("createPoll tx", tx.hash);
await tx.wait();
let pid: number | null = null;
for (let i = 0; i < 20 && !pid; i++) { await new Promise((r) => setTimeout(r, 3000)); const ps = db.listPolls(); if (ps.length) pid = ps[0].id; }
console.log("poll id", pid);
if (pid) { [0, 0, 0, 0, 1, 1, 2].forEach((opt, i) => db.addVote(pid!, `web:seedvote${i}`, opt, ethers.Wallet.createRandom().address, Date.now())); console.log("seeded display votes"); }
db.close();
