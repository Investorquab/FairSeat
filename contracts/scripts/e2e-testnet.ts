import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Live end-to-end on BSC testnet against the mock registry:
// verify -> create+fund giveaway -> commit entrants -> resolve -> payout.
const SCAN = "https://testnet.bscscan.com";

async function main() {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), "utf8")
  );
  const [deployer] = await ethers.getSigners();
  console.log(`Network ${network.name} · deployer ${deployer.address}`);

  const registry = await ethers.getContractAt("MockAgentIdRegistry", dep.registry);
  const verifier = await ethers.getContractAt("FairSeatVerifier", dep.verifier);
  const vault = await ethers.getContractAt("GiveawayVault", dep.vault);

  // Two throwaway entrant addresses (they only need to RECEIVE, so no gas needed).
  const alice = ethers.Wallet.createRandom().address;
  const bob = ethers.Wallet.createRandom().address;

  // 1) Give the deployer + the two entrants an Agent ID in the mock registry.
  console.log("\n[1] Assigning Agent IDs (mock registry)...");
  for (const a of [deployer.address, alice, bob]) {
    if ((await registry.balanceOf(a)) === 0n) {
      const tx = await registry.assign(a);
      await tx.wait();
      console.log(`   assigned ${a}  ${SCAN}/tx/${tx.hash}`);
    }
  }

  // 2) Verify the deployer by a tiny self-send to the Verifier.
  console.log("\n[2] Verify by dust send to FairSeatVerifier...");
  const vtx = await deployer.sendTransaction({ to: dep.verifier, value: ethers.parseEther("0.00001") });
  const vrc = await vtx.wait();
  const verifiedEvt = vrc!.logs
    .map((l) => {
      try {
        return verifier.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "Verified");
  console.log(`   Verified(${verifiedEvt?.args[0]}, ${verifiedEvt?.args[1]})  ${SCAN}/tx/${vtx.hash}`);

  // 3) Create + fund a giveaway (OffChainTap, Random, 1 winner, tiny prize).
  console.log("\n[3] Create + fund giveaway (locks the reward)...");
  const prize = ethers.parseEther("0.0002");
  const current = await ethers.provider.getBlockNumber();
  const drawBlock = current + 30; // a few blocks ahead (~12s on testnet)
  const ctx = await vault.createGiveaway(ethers.ZeroAddress, prize, 1, 1 /*Random*/, 0 /*OffChainTap*/, drawBlock, {
    value: prize,
  });
  const crc = await ctx.wait();
  const createdEvt = crc!.logs.map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } })
    .find((e) => e?.name === "GiveawayCreated");
  const id = createdEvt!.args[0];
  console.log(`   Giveaway #${id} funded ${ethers.formatEther(prize)} tBNB, drawBlock ${drawBlock}  ${SCAN}/tx/${ctx.hash}`);
  console.log(`   vault locked balance: ${ethers.formatEther(await ethers.provider.getBalance(dep.vault))} tBNB`);

  // 4) Commit entrants (operator = deployer here).
  console.log("\n[4] Commit entrants [alice, bob]...");
  const etx = await vault.commitEntrants(id, [alice, bob]);
  await etx.wait();
  console.log(`   committed  ${SCAN}/tx/${etx.hash}`);

  // 5) Wait until past the draw block, then resolve (permissionless).
  console.log("\n[5] Waiting for draw block, then resolve...");
  while ((await ethers.provider.getBlockNumber()) <= drawBlock) {
    await new Promise((r) => setTimeout(r, 2000));
  }
  const aBefore = await ethers.provider.getBalance(alice);
  const bBefore = await ethers.provider.getBalance(bob);
  const rtx = await vault.resolve(id);
  const rrc = await rtx.wait();
  const resolvedEvt = rrc!.logs.map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } })
    .find((e) => e?.name === "Resolved");
  const winners: string[] = resolvedEvt!.args[2];
  console.log(`   Resolved: winner(s) ${winners.join(", ")}  seed ${resolvedEvt!.args[1]}`);
  console.log(`   ${SCAN}/tx/${rtx.hash}`);

  const aAfter = await ethers.provider.getBalance(alice);
  const bAfter = await ethers.provider.getBalance(bob);
  console.log(`\n   alice ${alice}: +${ethers.formatEther(aAfter - aBefore)} tBNB`);
  console.log(`   bob   ${bob}: +${ethers.formatEther(bAfter - bBefore)} tBNB`);
  console.log(`   vault balance now: ${ethers.formatEther(await ethers.provider.getBalance(dep.vault))} tBNB`);
  console.log("\nE2E complete. Contracts:");
  console.log(`   Verifier ${SCAN}/address/${dep.verifier}`);
  console.log(`   Vault    ${SCAN}/address/${dep.vault}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
