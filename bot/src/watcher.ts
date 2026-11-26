import { ethers } from "ethers";
import type { Chain } from "./chain.js";
import type { Service, ResolvedInfo } from "./service.js";
import type { GiveawayRow } from "./db.js";

export interface Notifier {
  onVerified(telegramId: number, wallet: string): Promise<void>;
  onGiveawayLive(g: GiveawayRow): Promise<void>;
  onEntered?(giveawayId: number, telegramId: number): Promise<void>;
  onResolved(info: ResolvedInfo, seed: string, txHash: string): Promise<void>;
}

const POLL_MS = 5000;
const MAX_RANGE = 2000;

export class Watcher {
  private last = 0;
  private running = false;

  constructor(
    private chain: Chain,
    private service: Service,
    private notifier: Notifier
  ) {}

  async start(fromBlock?: number): Promise<void> {
    this.last = fromBlock ?? (await this.chain.blockNumber());
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.poll();
      } catch (e) {
        console.error("[watcher] poll error:", (e as Error).message);
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  async poll(): Promise<void> {
    const current = await this.chain.blockNumber();
    if (current > this.last) {
      let from = this.last + 1;
      while (from <= current) {
        const to = Math.min(from, current, from + MAX_RANGE - 1) === from ? Math.min(current, from + MAX_RANGE - 1) : current;
        await this.scan(from, to);
        from = to + 1;
      }
      this.last = current;
    }
    // Drive the commit/resolve scheduler each poll.
    await this.service.tickDueGiveaways();
  }

  private async scan(from: number, to: number): Promise<void> {
    const { verifier, vault } = this.chain;

    // Verified
    for (const log of await verifier.queryFilter(verifier.filters.Verified(), from, to)) {
      const { account, amount } = (log as ethers.EventLog).args as unknown as { account: string; amount: bigint };
      const match = this.service.handleVerified(account, amount);
      if (match) await this.notifier.onVerified(match.telegramId, match.wallet);
    }

    // GiveawayCreated
    for (const log of await vault.queryFilter(vault.filters.GiveawayCreated(), from, to)) {
      const a = (log as ethers.EventLog).args as unknown as {
        id: bigint; host: string; token: string; prize: bigint;
        winnerCount: bigint; rule: bigint; entryMode: bigint; drawBlock: bigint;
      };
      const g = this.service.handleGiveawayCreated({
        id: Number(a.id), host: a.host, token: a.token, prize: a.prize,
        winnerCount: Number(a.winnerCount), rule: Number(a.rule),
        entryMode: Number(a.entryMode), drawBlock: Number(a.drawBlock),
      });
      if (g) await this.notifier.onGiveawayLive(g);
    }

    // Entered (on-chain entry mode)
    for (const log of await vault.queryFilter(vault.filters.Entered(), from, to)) {
      const a = (log as ethers.EventLog).args as unknown as { id: bigint; account: string };
      const tid = this.service.handleEntered(Number(a.id), a.account);
      if (tid && this.notifier.onEntered) await this.notifier.onEntered(Number(a.id), tid);
    }

    // Resolved
    for (const log of await vault.queryFilter(vault.filters.Resolved(), from, to)) {
      const a = (log as ethers.EventLog).args as unknown as {
        id: bigint; seed: string; winners: string[]; perWinner: bigint; leftoverToHost: bigint;
      };
      const info = this.service.handleResolved(Number(a.id), a.winners, a.perWinner);
      if (info) await this.notifier.onResolved(info, a.seed, (log as ethers.EventLog).transactionHash);
    }
  }
}
