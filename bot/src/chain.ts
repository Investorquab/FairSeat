import { ethers, FetchRequest, type FetchGetUrlFunc } from "ethers";
import { config } from "./config.js";

// --- Proxy-aware fetch -------------------------------------------------------------
// ethers v6 uses Node's http/https directly and ignores HTTPS_PROXY. In this cloud
// sandbox all egress must go through the agent proxy, so when `http_proxy` is set we
// route ethers through Node's global fetch (which honours the proxy when the process is
// started with NODE_USE_ENV_PROXY=1). On a normal VPS `http_proxy` is unset and ethers
// uses its default transport - nothing changes.
export function configureProxyFetch(): void {
  if (!process.env.http_proxy && !process.env.HTTPS_PROXY) return;
  const getUrl: FetchGetUrlFunc = async (req) => {
    const resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body ? Buffer.from(req.body) : undefined,
    });
    const body = new Uint8Array(await resp.arrayBuffer());
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => (headers[k] = v));
    return { statusCode: resp.status, statusMessage: resp.statusText, headers, body };
  };
  FetchRequest.registerGetUrl(getUrl);
}

export const REGISTRY_ABI = ["function balanceOf(address) view returns (uint256)"];

export const VERIFIER_ABI = [
  "event Verified(address indexed account, uint256 amount)",
  "function holdsAgentId(address) view returns (bool)",
];

export const VAULT_ABI = [
  "event GiveawayCreated(uint256 indexed id, address indexed host, address token, uint256 prize, uint32 winnerCount, uint8 rule, uint8 entryMode, uint64 drawBlock)",
  "event Entered(uint256 indexed id, address indexed account)",
  "event EntrantsCommitted(uint256 indexed id, uint256 count)",
  "event Resolved(uint256 indexed id, bytes32 seed, address[] winners, uint256 perWinner, uint256 leftoverToHost)",
  "function createGiveaway(address token, uint256 prize, uint32 winnerCount, uint8 rule, uint8 entryMode, uint64 drawBlock) payable returns (uint256)",
  "function enter(uint256 id)",
  "function commitEntrants(uint256 id, address[] entrants)",
  "function resolve(uint256 id)",
  "function cancel(uint256 id)",
  "function getGiveaway(uint256 id) view returns (address host, address token, uint256 prize, uint32 winnerCount, uint8 rule, uint8 entryMode, uint64 drawBlock, uint8 state, uint256 entrantCount)",
  "function getEntrants(uint256 id) view returns (address[])",
];

export const POLL_ABI = [
  "event PollCreated(uint256 indexed id, address indexed host, uint8 numOptions, uint64 closeBlock, uint8 mode)",
  "event Voted(uint256 indexed id, address indexed voter, uint8 option)",
  "function createPoll(uint8 numOptions, uint64 closeBlock, uint8 mode) returns (uint256)",
  "function vote(uint256 id, uint8 option)",
  "function commitVotes(uint256 id, address[] voters, uint8[] options)",
  "function getPoll(uint256 id) view returns (address host, uint8 numOptions, uint64 closeBlock, uint8 mode, uint256 votes, bool closed)",
  "function getTally(uint256 id) view returns (uint256[])",
];

export class Chain {
  readonly provider: ethers.JsonRpcProvider;
  readonly registry: ethers.Contract;
  readonly verifier: ethers.Contract;
  readonly vault: ethers.Contract;
  readonly poll: ethers.Contract;
  readonly operator?: ethers.Wallet;

  constructor() {
    configureProxyFetch();
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
    this.registry = new ethers.Contract(config.registryAddress, REGISTRY_ABI, this.provider);
    this.verifier = new ethers.Contract(config.verifierAddress, VERIFIER_ABI, this.provider);
    const pollAddr = config.pollAddress || ethers.ZeroAddress;
    if (config.operatorKey) {
      this.operator = new ethers.Wallet(config.operatorKey, this.provider);
      this.vault = new ethers.Contract(config.vaultAddress, VAULT_ABI, this.operator);
      this.poll = new ethers.Contract(pollAddr, POLL_ABI, this.operator);
    } else {
      this.vault = new ethers.Contract(config.vaultAddress, VAULT_ABI, this.provider);
      this.poll = new ethers.Contract(pollAddr, POLL_ABI, this.provider);
    }
  }

  blockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async holdsAgentId(address: string): Promise<boolean> {
    return (await this.registry.balanceOf(address)) > 0n;
  }

  // Encode a createGiveaway call so a host can execute it from their own wallet.
  encodeCreateGiveaway(
    token: string,
    prizeWei: bigint,
    winnerCount: number,
    rule: number,
    entryMode: number,
    drawBlock: number
  ): { to: string; value: string; data: string } {
    const iface = new ethers.Interface(VAULT_ABI);
    const data = iface.encodeFunctionData("createGiveaway", [
      token,
      prizeWei,
      winnerCount,
      rule,
      entryMode,
      drawBlock,
    ]);
    return {
      to: config.vaultAddress,
      value: token === ethers.ZeroAddress ? prizeWei.toString() : "0",
      data,
    };
  }

  // Operator-only: commit off-chain-tap entrants.
  async commitEntrants(id: number, entrants: string[]): Promise<string> {
    if (!this.operator) throw new Error("operator key not configured");
    const tx = await this.vault.commitEntrants(id, entrants);
    await tx.wait();
    return tx.hash;
  }

  // Permissionless: resolve a giveaway (operator pays the gas as a convenience).
  async resolve(id: number): Promise<string> {
    if (!this.operator) throw new Error("operator key not configured");
    const tx = await this.vault.resolve(id);
    await tx.wait();
    return tx.hash;
  }

  // ---- polls ----
  encodeCreatePoll(numOptions: number, closeBlock: number, mode: number): { to: string; value: string; data: string } {
    const iface = new ethers.Interface(POLL_ABI);
    return { to: config.pollAddress, value: "0", data: iface.encodeFunctionData("createPoll", [numOptions, closeBlock, mode]) };
  }
  async commitVotes(id: number, voters: string[], options: number[]): Promise<string> {
    if (!this.operator) throw new Error("operator key not configured");
    const tx = await this.poll.commitVotes(id, voters, options);
    await tx.wait();
    return tx.hash;
  }
  async getTally(id: number): Promise<number[]> {
    const t: bigint[] = await this.poll.getTally(id);
    return t.map((x) => Number(x));
  }
}
