import { ethers } from "ethers";
import type { FairSeatDB, GiveawayRow } from "./db.js";
import type { Chain } from "./chain.js";
import { config } from "./config.js";
import { generateVerifyAmount, matchVerification } from "./verify.js";

export const Rule = { FirstN: 0, Random: 1, SplitEqually: 2 } as const;
export const EntryMode = { OffChainTap: 0, OnChainEnter: 1 } as const;

export const RULE_LABEL: Record<number, string> = {
  0: "first N entrants",
  1: "random draw (provably fair)",
  2: "split equally among all",
};

// Entries close this many blocks before the draw block, so the off-chain set can be
// committed on-chain before the seed (draw block) exists.
export const COMMIT_WINDOW_BLOCKS = 15;
// Assume a very fast block time when sizing the draw block, so it always lands well AFTER
// entries close by wall clock (BSC blocks can be sub-second; underestimating would close
// entries early). The real entry window is wall-clock based, not block based.
const ASSUMED_BLOCK_SEC = 0.5;

export interface CreateParams {
  creatorTelegramId: number;
  chatId: number;
  token: string; // ZeroAddress for native
  prizeWei: bigint;
  winnerCount: number;
  rule: number;
  entryMode: number;
  scope: "members" | "public" | "private";
  accessKey: string | null;
  durationSeconds: number;
}

export type EnterResult =
  | { ok: true; mode: "tap" }
  | { ok: true; mode: "onchain"; action: { to: string; value: string; data: string } }
  | { ok: false; reason: "not_verified" | "not_open" | "closed" | "already" | "wrong_key" | "not_member" };

export interface ResolvedInfo {
  giveaway: GiveawayRow;
  winners: { address: string; telegramId?: number }[];
  perWinnerWei: bigint;
}

export class Service {
  constructor(
    private db: FairSeatDB,
    private chain: Chain
  ) {}

  // ---- verification ----
  startVerification(telegramId: number): { alreadyVerified: boolean; wallet?: string; amountWei?: bigint } {
    const existing = this.db.getUserByTelegram(telegramId);
    if (existing) return { alreadyVerified: true, wallet: existing.wallet };
    const amountWei = generateVerifyAmount(this.db);
    this.db.createVerifySession(telegramId, amountWei.toString(), Date.now());
    return { alreadyVerified: false, amountWei };
  }

  handleVerified(account: string, amountWei: bigint) {
    return matchVerification(this.db, account, amountWei, Date.now());
  }

  walletOf(telegramId: number): string | undefined {
    return this.db.getUserByTelegram(telegramId)?.wallet;
  }

  // ---- giveaway creation (the host signs the on-chain funding tx) ----
  async prepareGiveaway(
    p: CreateParams
  ): Promise<{ pendingId: number; drawBlock: number; tx: { to: string; value: string; data: string } } | { error: string }> {
    const host = this.db.getUserByTelegram(p.creatorTelegramId);
    if (!host) return { error: "You must verify first — send /verify to me in a private chat." };
    if (p.prizeWei <= 0n) return { error: "Prize must be greater than zero." };
    if (p.rule !== Rule.SplitEqually && p.winnerCount < 1) return { error: "Winner count must be at least 1." };
    if (p.scope === "private" && !p.accessKey) return { error: "A private giveaway needs an access key." };
    if (p.entryMode === EntryMode.OnChainEnter && p.scope !== "public")
      return { error: "On-chain entry is public only; use tap entry for members/private giveaways." };

    const now = await this.chain.blockNumber();
    const entriesCloseAt = Date.now() + p.durationSeconds * 1000;
    const durationBlocks = Math.ceil(p.durationSeconds / ASSUMED_BLOCK_SEC);
    const drawBlock = now + durationBlocks + COMMIT_WINDOW_BLOCKS + 10;

    const pendingId = this.db.insertPendingCreation({
      creator_telegram_id: p.creatorTelegramId,
      host_wallet: host.wallet,
      chat_id: p.chatId,
      token: p.token,
      prize_wei: p.prizeWei.toString(),
      winner_count: p.winnerCount,
      rule: p.rule,
      entry_mode: p.entryMode,
      scope: p.scope,
      access_key: p.accessKey,
      entries_close_at: entriesCloseAt,
      draw_block: drawBlock,
      created_at: Date.now(),
    });

    const tx = this.chain.encodeCreateGiveaway(p.token, p.prizeWei, p.winnerCount, p.rule, p.entryMode, drawBlock);
    return { pendingId, drawBlock, tx };
  }

  // Called when GiveawayCreated is seen on-chain → link to a pending creation and store it.
  handleGiveawayCreated(ev: {
    id: number; host: string; token: string; prize: bigint;
    winnerCount: number; rule: number; entryMode: number; drawBlock: number;
  }): GiveawayRow | null {
    if (this.db.getGiveaway(ev.id)) return null; // already recorded
    const pending = this.db.findMatchingPendingCreation(
      ev.host, ev.token, ev.prize.toString(), ev.winnerCount, ev.rule, ev.entryMode, ev.drawBlock
    );
    if (!pending) return null;
    this.db.insertGiveaway({
      id: ev.id,
      chat_id: pending.chat_id,
      creator_telegram_id: pending.creator_telegram_id,
      token: ev.token,
      prize_wei: ev.prize.toString(),
      winner_count: ev.winnerCount,
      rule: ev.rule,
      entry_mode: ev.entryMode,
      scope: pending.scope,
      access_key: pending.access_key,
      entries_close_at: pending.entries_close_at,
      draw_block: ev.drawBlock,
      created_at: Date.now(),
    });
    this.db.markPendingMatched(pending.id);
    return this.db.getGiveaway(ev.id) ?? null;
  }

  // ---- entry ----
  async enterGiveaway(
    giveawayId: number,
    telegramId: number,
    opts: { membershipOk: boolean; providedKey?: string }
  ): Promise<EnterResult> {
    const g = this.db.getGiveaway(giveawayId);
    if (!g || g.status !== "open") return { ok: false, reason: "not_open" };

    const user = this.db.getUserByTelegram(telegramId);
    if (!user) return { ok: false, reason: "not_verified" };

    if (g.scope === "members" && !opts.membershipOk) return { ok: false, reason: "not_member" };
    if (g.scope === "private" && (opts.providedKey ?? "") !== (g.access_key ?? "")) return { ok: false, reason: "wrong_key" };

    if (Date.now() >= g.entries_close_at) return { ok: false, reason: "closed" };
    if (this.db.hasEntered(giveawayId, telegramId)) return { ok: false, reason: "already" };

    if (g.entry_mode === EntryMode.OnChainEnter) {
      const iface = new ethers.Interface(["function enter(uint256 id)"]);
      return {
        ok: true,
        mode: "onchain",
        action: { to: config.vaultAddress, value: "0", data: iface.encodeFunctionData("enter", [giveawayId]) },
      };
    }

    this.db.addEntry(giveawayId, telegramId, user.wallet, Date.now());
    return { ok: true, mode: "tap" };
  }

  // Called when an on-chain Entered event is seen (OnChainEnter giveaways).
  handleEntered(giveawayId: number, account: string): number | null {
    const user = this.db.getUserByWallet(account);
    if (!user) return null;
    this.db.addEntry(giveawayId, user.telegram_id, ethers.getAddress(account), Date.now());
    return user.telegram_id;
  }

  // ---- scheduler: commit off-chain entrants, then trigger resolve ----
  async tickDueGiveaways(): Promise<void> {
    const current = await this.chain.blockNumber();
    const now = Date.now();

    for (const g of this.db.listOpenGiveaways()) {
      // 1) Once entries have closed (wall clock) and before the draw block, commit the
      //    off-chain-tap entrant set on-chain.
      if (g.entry_mode === EntryMode.OffChainTap && !g.committed && now >= g.entries_close_at && current < g.draw_block) {
        const entrants = this.db.getEntries(g.id).map((e) => e.wallet);
        if (entrants.length > 0) await this.chain.commitEntrants(g.id, entrants);
        this.db.setCommitted(g.id);
      }
      // 2) Resolve after the draw block (the Resolved event drives result-posting).
      if (current > g.draw_block && (g.entry_mode === EntryMode.OnChainEnter || g.committed)) {
        await this.chain.resolve(g.id);
        this.db.setGiveawayStatus(g.id, "resolved");
      }
    }
  }

  // Called when a Resolved event is seen → map winners to Telegram users for notifications.
  handleResolved(id: number, winners: string[], perWinnerWei: bigint): ResolvedInfo | null {
    const g = this.db.getGiveaway(id);
    if (!g) return null;
    if (g.status !== "resolved") this.db.setGiveawayStatus(id, "resolved");
    return {
      giveaway: g,
      perWinnerWei,
      winners: winners.map((w) => {
        const u = this.db.getUserByWallet(w);
        return { address: ethers.getAddress(w), telegramId: u?.telegram_id };
      }),
    };
  }
}
