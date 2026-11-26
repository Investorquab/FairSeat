import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";

const Mode = { OnChainVote: 0, OffChainTap: 1 } as const;

describe("Poll", () => {
  async function deploy() {
    const [host, operator, a, b, c, stranger] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("MockAgentIdRegistry");
    const reg = await Reg.deploy();
    await reg.waitForDeployment();
    for (const s of [host, a, b, c]) await (await reg.assign(s.address)).wait();

    const Poll = await ethers.getContractFactory("Poll");
    const poll = await Poll.deploy(await reg.getAddress(), operator.address);
    await poll.waitForDeployment();
    return { reg, poll, host, operator, a, b, c, stranger };
  }
  const blk = async () => BigInt(await ethers.provider.getBlockNumber());

  it("on-chain vote: one Agent ID = one vote, tally is public", async () => {
    const { poll, a, b, c, stranger } = await deploy();
    await poll.createPoll(3, (await blk()) + 50n, Mode.OnChainVote);

    await expect(poll.connect(a).vote(1, 0)).to.emit(poll, "Voted").withArgs(1, a.address, 0);
    await (await poll.connect(b).vote(1, 0)).wait();
    await (await poll.connect(c).vote(1, 2)).wait();

    await expect(poll.connect(a).vote(1, 1)).to.be.revertedWithCustomError(poll, "AlreadyVoted");
    await expect(poll.connect(stranger).vote(1, 0)).to.be.revertedWithCustomError(poll, "NotAgentIdHolder");
    const tally = await poll.getTally(1);
    expect(tally.map(Number)).to.deep.equal([2, 0, 1]);
    expect(await poll.totalVotes(1)).to.equal(3n);
  });

  it("rejects bad option and votes after close", async () => {
    const { poll, a, b } = await deploy();
    await poll.createPoll(2, (await blk()) + 4n, Mode.OnChainVote);
    await expect(poll.connect(a).vote(1, 2)).to.be.revertedWithCustomError(poll, "BadOption");
    await (await poll.connect(a).vote(1, 0)).wait();
    await mine(5);
    await expect(poll.connect(b).vote(1, 1)).to.be.revertedWithCustomError(poll, "Closed");
  });

  it("off-chain tap: only operator commits, gated + deduplicated", async () => {
    const { poll, host, operator, a, b, c, stranger } = await deploy();
    await poll.createPoll(2, (await blk()) + 50n, Mode.OffChainTap);

    await expect(poll.connect(host).commitVotes(1, [a.address], [0])).to.be.revertedWithCustomError(poll, "NotOperator");
    await expect(poll.connect(a).vote(1, 0)).to.be.revertedWithCustomError(poll, "WrongMode");

    // stranger (no Agent ID) is skipped; a and b counted; duplicate a ignored
    await (await poll.connect(operator).commitVotes(1, [a.address, b.address, stranger.address, a.address, c.address], [0, 1, 0, 1, 1])).wait();
    const tally = await poll.getTally(1);
    expect(tally.map(Number)).to.deep.equal([1, 2]); // a->0, b->1, c->1 ; stranger skipped, dup a skipped
    expect(await poll.totalVotes(1)).to.equal(3n);
  });

  it("getPoll reports closed state after the close block", async () => {
    const { poll } = await deploy();
    await poll.createPoll(2, (await blk()) + 3n, Mode.OnChainVote);
    let p = await poll.getPoll(1);
    expect(p.closed).to.equal(false);
    await mine(4);
    p = await poll.getPoll(1);
    expect(p.closed).to.equal(true);
  });
});
