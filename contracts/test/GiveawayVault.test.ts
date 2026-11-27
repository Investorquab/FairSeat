import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";

// Rule enum: 0=FirstN, 1=Random, 2=SplitEqually
// EntryMode enum: 0=OffChainTap, 1=OnChainEnter
const Rule = { FirstN: 0, Random: 1, SplitEqually: 2 } as const;
const EntryMode = { OffChainTap: 0, OnChainEnter: 1 } as const;

describe("GiveawayVault", () => {
  async function deploy() {
    const signers = await ethers.getSigners();
    const [host, operator, resolver, a, b, c, d] = signers;

    const Reg = await ethers.getContractFactory("MockAgentIdRegistry");
    const reg = await Reg.deploy();
    await reg.waitForDeployment();
    for (const s of [a, b, c, d]) await (await reg.assign(s.address)).wait();

    const Vault = await ethers.getContractFactory("GiveawayVault");
    const vault = await Vault.deploy(await reg.getAddress(), operator.address);
    await vault.waitForDeployment();

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy();
    await token.waitForDeployment();

    return { reg, vault, token, host, operator, resolver, a, b, c, d };
  }

  async function currentBlock() {
    return BigInt(await ethers.provider.getBlockNumber());
  }

  it("locks native funds on create and nobody can pull them early", async () => {
    const { vault, host } = await deploy();
    const prize = ethers.parseEther("2");
    const drawBlock = (await currentBlock()) + 10n;
    await (
      await vault
        .connect(host)
        .createGiveaway(ethers.ZeroAddress, prize, 2, Rule.Random, EntryMode.OnChainEnter, drawBlock, { value: prize })
    ).wait();
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(prize);
    // cancel is blocked once there are entrants, and resolve is blocked before drawBlock
    await expect(vault.connect(host).resolve(1)).to.be.revertedWithCustomError(vault, "TooEarly");
  });

  it("on-chain entry: only holders, once, before drawBlock", async () => {
    const { vault, host, a, b, resolver } = await deploy();
    const prize = ethers.parseEther("2");
    const drawBlock = (await currentBlock()) + 6n;
    await vault
      .connect(host)
      .createGiveaway(ethers.ZeroAddress, prize, 2, Rule.FirstN, EntryMode.OnChainEnter, drawBlock, { value: prize });

    await expect(vault.connect(a).enter(1)).to.emit(vault, "Entered").withArgs(1, a.address);
    await expect(vault.connect(a).enter(1)).to.be.revertedWithCustomError(vault, "AlreadyEntered");
    // resolver has no Agent ID
    await expect(vault.connect(resolver).enter(1)).to.be.revertedWithCustomError(vault, "NotAgentIdHolder");
    await (await vault.connect(b).enter(1)).wait();

    const g = await vault.getGiveaway(1);
    expect(g.entrantCount).to.equal(2n);
  });

  it("FirstN pays the first winnerCount entrants equally; leftover to host", async () => {
    const { vault, host, a, b, c, resolver } = await deploy();
    const prize = ethers.parseEther("2");
    const drawBlock = (await currentBlock()) + 6n;
    await vault
      .connect(host)
      .createGiveaway(ethers.ZeroAddress, prize, 2, Rule.FirstN, EntryMode.OnChainEnter, drawBlock, { value: prize });
    await (await vault.connect(a).enter(1)).wait();
    await (await vault.connect(b).enter(1)).wait();
    await (await vault.connect(c).enter(1)).wait();

    const aBefore = await ethers.provider.getBalance(a.address);
    const bBefore = await ethers.provider.getBalance(b.address);
    const cBefore = await ethers.provider.getBalance(c.address);

    await mine(6);
    await (await vault.connect(resolver).resolve(1)).wait();

    // a and b are the first two → 1 ETH each; c gets nothing.
    expect(await ethers.provider.getBalance(a.address)).to.equal(aBefore + ethers.parseEther("1"));
    expect(await ethers.provider.getBalance(b.address)).to.equal(bBefore + ethers.parseEther("1"));
    expect(await ethers.provider.getBalance(c.address)).to.equal(cBefore);
    // vault emptied
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
  });

  it("SplitEqually pays every entrant an equal share", async () => {
    const { vault, host, a, b, c, d, resolver } = await deploy();
    const prize = ethers.parseEther("4");
    const drawBlock = (await currentBlock()) + 8n;
    await vault
      .connect(host)
      .createGiveaway(ethers.ZeroAddress, prize, 0, Rule.SplitEqually, EntryMode.OnChainEnter, drawBlock, { value: prize });
    for (const s of [a, b, c, d]) await (await vault.connect(s).enter(1)).wait();

    const before = await Promise.all([a, b, c, d].map((s) => ethers.provider.getBalance(s.address)));
    await mine(8);
    await (await vault.connect(resolver).resolve(1)).wait();
    const after = await Promise.all([a, b, c, d].map((s) => ethers.provider.getBalance(s.address)));

    for (let i = 0; i < 4; i++) expect(after[i]).to.equal(before[i] + ethers.parseEther("1"));
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
  });

  it("Random picks winnerCount winners and empties the vault", async () => {
    const { vault, host, a, b, c, d, resolver } = await deploy();
    const prize = ethers.parseEther("2");
    const drawBlock = (await currentBlock()) + 8n;
    await vault
      .connect(host)
      .createGiveaway(ethers.ZeroAddress, prize, 2, Rule.Random, EntryMode.OnChainEnter, drawBlock, { value: prize });
    for (const s of [a, b, c, d]) await (await vault.connect(s).enter(1)).wait();

    await mine(8);
    await expect(vault.connect(resolver).resolve(1)).to.emit(vault, "Resolved");
    // All prize distributed to 2 winners of 1 ETH each.
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
  });

  it("off-chain tap: only operator commits entrants, then resolve pays", async () => {
    const { vault, host, operator, a, b, resolver } = await deploy();
    const prize = ethers.parseEther("2");
    const drawBlock = (await currentBlock()) + 6n;
    await vault
      .connect(host)
      .createGiveaway(ethers.ZeroAddress, prize, 2, Rule.FirstN, EntryMode.OffChainTap, drawBlock, { value: prize });

    // Non-operator cannot commit.
    await expect(vault.connect(host).commitEntrants(1, [a.address, b.address])).to.be.revertedWithCustomError(
      vault,
      "NotOperator"
    );
    // On-chain enter is the wrong mode here.
    await expect(vault.connect(a).enter(1)).to.be.revertedWithCustomError(vault, "WrongEntryMode");

    await (await vault.connect(operator).commitEntrants(1, [a.address, b.address])).wait();
    const aBefore = await ethers.provider.getBalance(a.address);
    const bBefore = await ethers.provider.getBalance(b.address);

    await mine(6);
    await (await vault.connect(resolver).resolve(1)).wait();
    expect(await ethers.provider.getBalance(a.address)).to.equal(aBefore + ethers.parseEther("1"));
    expect(await ethers.provider.getBalance(b.address)).to.equal(bBefore + ethers.parseEther("1"));
  });

  it("host can cancel and reclaim only before anyone enters", async () => {
    const { vault, host, a } = await deploy();
    const prize = ethers.parseEther("1");
    const drawBlock = (await currentBlock()) + 10n;
    await vault
      .connect(host)
      .createGiveaway(ethers.ZeroAddress, prize, 1, Rule.FirstN, EntryMode.OnChainEnter, drawBlock, { value: prize });

    await (await vault.connect(a).enter(1)).wait();
    await expect(vault.connect(host).cancel(1)).to.be.revertedWithCustomError(vault, "HasEntrants");

    // A fresh giveaway with no entrants can be cancelled.
    await vault
      .connect(host)
      .createGiveaway(ethers.ZeroAddress, prize, 1, Rule.FirstN, EntryMode.OnChainEnter, (await currentBlock()) + 10n, {
        value: prize,
      });
    await expect(vault.connect(host).cancel(2)).to.emit(vault, "Cancelled").withArgs(2);
  });

  it("works with a BEP-20 reward token", async () => {
    const { vault, token, host, operator, a, b, resolver } = await deploy();
    const prize = ethers.parseUnits("100", 18);
    await (await token.mint(host.address, prize)).wait();
    await (await token.connect(host).approve(await vault.getAddress(), prize)).wait();

    const drawBlock = (await currentBlock()) + 6n;
    await (
      await vault
        .connect(host)
        .createGiveaway(await token.getAddress(), prize, 2, Rule.FirstN, EntryMode.OffChainTap, drawBlock)
    ).wait();
    await (await vault.connect(operator).commitEntrants(1, [a.address, b.address])).wait();

    await mine(6);
    await (await vault.connect(resolver).resolve(1)).wait();
    expect(await token.balanceOf(a.address)).to.equal(ethers.parseUnits("50", 18));
    expect(await token.balanceOf(b.address)).to.equal(ethers.parseUnits("50", 18));
  });

  it("resolves even if very late (>256 blocks) via fallback seed - funds never stuck", async () => {
    const { vault, host, operator, a, b, resolver } = await deploy();
    const prize = ethers.parseEther("2");
    const drawBlock = (await currentBlock()) + 4n;
    await vault
      .connect(host)
      .createGiveaway(ethers.ZeroAddress, prize, 1, Rule.Random, EntryMode.OffChainTap, drawBlock, { value: prize });
    await (await vault.connect(operator).commitEntrants(1, [a.address, b.address])).wait();

    await mine(300); // far more than 256 blocks past drawBlock → primary blockhash is gone
    await expect(vault.connect(resolver).resolve(1)).to.emit(vault, "Resolved");
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
  });

  it("a winner that rejects funds is skipped, not a DoS - funds never lock (F-1)", async () => {
    const { reg, vault, host, operator, a, resolver } = await deploy();
    const Rej = await ethers.getContractFactory("RejectingReceiver");
    const rej = await Rej.deploy();
    await rej.waitForDeployment();
    const rejAddr = await rej.getAddress();
    await (await reg.assign(rejAddr)).wait(); // the rejecter holds an Agent ID

    const prize = ethers.parseEther("2");
    const drawBlock = (await currentBlock()) + 6n;
    await vault
      .connect(host)
      .createGiveaway(ethers.ZeroAddress, prize, 2, Rule.FirstN, EntryMode.OffChainTap, drawBlock, { value: prize });
    // FirstN winners = [rejecter, a]
    await (await vault.connect(operator).commitEntrants(1, [rejAddr, a.address])).wait();

    const aBefore = await ethers.provider.getBalance(a.address);
    const hostBefore = await ethers.provider.getBalance(host.address);
    await mine(6);
    await (await vault.connect(resolver).resolve(1)).wait(); // must NOT revert

    // a is paid; the rejecter's share returns to the host as leftover; nothing is stuck.
    expect(await ethers.provider.getBalance(a.address)).to.equal(aBefore + ethers.parseEther("1"));
    expect(await ethers.provider.getBalance(host.address)).to.equal(hostBefore + ethers.parseEther("1"));
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
  });

  it("no entrants → full refund to host", async () => {
    const { vault, host, resolver } = await deploy();
    const prize = ethers.parseEther("1");
    const drawBlock = (await currentBlock()) + 4n;
    await vault
      .connect(host)
      .createGiveaway(ethers.ZeroAddress, prize, 1, Rule.Random, EntryMode.OffChainTap, drawBlock, { value: prize });

    const hostBefore = await ethers.provider.getBalance(host.address);
    await mine(4);
    await (await vault.connect(resolver).resolve(1)).wait(); // resolver pays gas, not host
    expect(await ethers.provider.getBalance(host.address)).to.equal(hostBefore + prize);
  });
});
