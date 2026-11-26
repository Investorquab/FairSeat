import { expect } from "chai";
import { ethers } from "hardhat";

describe("BatchDistributor", () => {
  async function deploy() {
    const [sender, a, b, c] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("MockAgentIdRegistry");
    const reg = await Reg.deploy();
    await reg.waitForDeployment();
    await (await reg.assign(a.address)).wait();
    await (await reg.assign(b.address)).wait(); // c has NO Agent ID

    const Dist = await ethers.getContractFactory("BatchDistributor");
    const dist = await Dist.deploy(await reg.getAddress());
    await dist.waitForDeployment();

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy();
    await token.waitForDeployment();
    return { reg, dist, token, sender, a, b, c };
  }

  it("pays Agent-ID holders, skips non-holders, refunds the rest (native)", async () => {
    const { dist, sender, a, b, c } = await deploy();
    const amtA = ethers.parseEther("1");
    const amtB = ethers.parseEther("2");
    const amtC = ethers.parseEther("3"); // c is not a holder → skipped + refunded
    const total = amtA + amtB + amtC;

    const aBefore = await ethers.provider.getBalance(a.address);
    const bBefore = await ethers.provider.getBalance(b.address);

    await expect(
      dist.connect(sender).distribute(ethers.ZeroAddress, [a.address, b.address, c.address], [amtA, amtB, amtC], { value: total })
    )
      .to.emit(dist, "Skipped")
      .withArgs(c.address, amtC)
      .and.to.emit(dist, "Distributed")
      .withArgs(sender.address, ethers.ZeroAddress, 2, amtA + amtB, amtC);

    expect(await ethers.provider.getBalance(a.address)).to.equal(aBefore + amtA);
    expect(await ethers.provider.getBalance(b.address)).to.equal(bBefore + amtB);
    // contract keeps nothing
    expect(await ethers.provider.getBalance(await dist.getAddress())).to.equal(0n);
  });

  it("works with a BEP-20 token", async () => {
    const { dist, token, sender, a, b, c } = await deploy();
    const total = ethers.parseUnits("60", 18);
    await (await token.mint(sender.address, total)).wait();
    await (await token.connect(sender).approve(await dist.getAddress(), total)).wait();

    await (await dist
      .connect(sender)
      .distribute(await token.getAddress(), [a.address, b.address, c.address], [ethers.parseUnits("10", 18), ethers.parseUnits("20", 18), ethers.parseUnits("30", 18)])
    ).wait();

    expect(await token.balanceOf(a.address)).to.equal(ethers.parseUnits("10", 18));
    expect(await token.balanceOf(b.address)).to.equal(ethers.parseUnits("20", 18));
    expect(await token.balanceOf(c.address)).to.equal(0n);
    // sender refunded c's 30
    expect(await token.balanceOf(sender.address)).to.equal(ethers.parseUnits("30", 18));
  });

  it("validates inputs and value", async () => {
    const { dist, sender, a } = await deploy();
    await expect(dist.connect(sender).distribute(ethers.ZeroAddress, [a.address], [1, 2])).to.be.revertedWithCustomError(dist, "LengthMismatch");
    await expect(dist.connect(sender).distribute(ethers.ZeroAddress, [], [])).to.be.revertedWithCustomError(dist, "EmptyList");
    await expect(dist.connect(sender).distribute(ethers.ZeroAddress, [a.address], [ethers.parseEther("1")], { value: 123 })).to.be.revertedWithCustomError(dist, "BadValue");
  });

  it("holders() previews which addresses hold an Agent ID", async () => {
    const { dist, a, b, c } = await deploy();
    expect(await dist.holders([a.address, b.address, c.address])).to.deep.equal([true, true, false]);
  });
});
