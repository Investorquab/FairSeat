import { expect } from "chai";
import { ethers } from "hardhat";

describe("FairSeatVerifier", () => {
  async function deploy() {
    const [deployer, holder, stranger] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("MockAgentIdRegistry");
    const reg = await Reg.deploy();
    await reg.waitForDeployment();
    await (await reg.assign(holder.address)).wait(); // holder gets an Agent ID

    const Verifier = await ethers.getContractFactory("FairSeatVerifier");
    const verifier = await Verifier.deploy(await reg.getAddress());
    await verifier.waitForDeployment();
    return { verifier, reg, deployer, holder, stranger };
  }

  it("verifies an Agent-ID holder, emits Verified, and refunds the dust", async () => {
    const { verifier, holder } = await deploy();
    const amount = ethers.parseEther("0.0001");

    await expect(holder.sendTransaction({ to: await verifier.getAddress(), value: amount }))
      .to.emit(verifier, "Verified")
      .withArgs(holder.address, amount);

    // Contract keeps nothing — the dust was refunded.
    expect(await ethers.provider.getBalance(await verifier.getAddress())).to.equal(0n);
  });

  it("rejects a non-holder (their funds never leave them)", async () => {
    const { verifier, stranger } = await deploy();
    await expect(
      stranger.sendTransaction({ to: await verifier.getAddress(), value: ethers.parseEther("0.0001") })
    ).to.be.revertedWithCustomError(verifier, "NotAgentIdHolder");
  });

  it("holdsAgentId reflects the registry", async () => {
    const { verifier, holder, stranger } = await deploy();
    expect(await verifier.holdsAgentId(holder.address)).to.equal(true);
    expect(await verifier.holdsAgentId(stranger.address)).to.equal(false);
  });
});
