import { expect } from "chai";
import { ethers } from "hardhat";

describe("MockAgentIdRegistry", () => {
  it("reports the real registry's name/symbol and gates by balanceOf", async () => {
    const [, alice] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("MockAgentIdRegistry");
    const reg = await Reg.deploy();
    await reg.waitForDeployment();

    expect(await reg.name()).to.equal("SPACE ID Agent ID");
    expect(await reg.symbol()).to.equal("AI");

    // Before assignment: not a holder.
    expect(await reg.balanceOf(alice.address)).to.equal(0n);

    // After assignment: holds exactly one.
    await (await reg.assign(alice.address)).wait();
    expect(await reg.balanceOf(alice.address)).to.equal(1n);

    // Soulbound-like: at most one per address.
    await expect(reg.assign(alice.address)).to.be.revertedWith("already holds Agent ID");
  });
});
