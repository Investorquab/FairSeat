import { ethers } from "ethers";
import { randomBytes } from "node:crypto";
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

// Entries close this many blocks before the draw block (fallback cushion), but the real
// entry window is wall-clock. See prepareGiveaway for how the draw block is sized.
export const COMMIT_WINDOW_BLOCKS = 15;
const DRAW_DELAY_SEC = 20;
const DRAW_SAFETY_BLOCKS = 20;

export interface CreateParams {
  creatorIdentity: string;
  hostWallet: string; // the address that will fund + lock the prize (needn't hold an Agent ID)
  chatId: number; // Telegram chat to announce in; 0 for web-only
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
  winners: { address: string; identity?: string }[];
  perWinnerWei: bigint;
}

export class Service {
  constructor(
    private db: FairSeatDB,
    private chain: Chain
  ) {}

  // ---- verification ----
  startVerification(identity: string): { alreadyVerified: boolean; wallet?: string; amountWei?: bigint } {
    const existing = this.db.getUser(identity);
    if (existing) return { alreadyVerified: true, wallet: existing.wallet };
    const amountWei = generateVerifyAmount(this.db);
    this.db.createVerifySession(identity, amountWei.toString(), Date.now());
    return { alreadyVerified: false, amountWei };
  }

  handleVerified(account: string, amountWei: bigint) {
    return matchVerification(this.db, account, amountWei, Date.now());
  }

  walletOf(identity: string): string | undefined {
    return this.db.getUser(identity)?.wallet;
  }

  // ---- giveaway creation (the host signs the on-chain funding tx) ----
  async prepareGiveaway(
    p: CreateParams
  ): Promise<{ pendingId: number; drawBlock: number; tx: { to: string; value: string; data: string } } | { error: string }> {
    let hostWallet: string;
    try {
      hostWallet = ethers.getAddress(p.hostWallet);
    } catch {
      return { error: "A valid host wallet address is required." };
    }
    if (p.prizeWei <= 0n) return { error: "Prize must be greater than zero." };
    if (p.rule !== Rule.SplitEqually && p.winnerCount < 1) return { error: "Winner count must be at least 1." };
    if (p.scope === "private" && !p.accessKey) return { error: "A private giveaway needs an access key." };
    if (p.entryMode === EntryMode.OnChainEnter && p.scope !== "public")
      return { error: "On-chain entry is public only; use tap entry for members/private giveaways." };

    const now = await this.chain.blockNumber();
    const entriesCloseAt = Date.now() + p.durationSeconds * 1000;
    const blocksUntilDraw =
      Math.ceil((p.durationSeconds + DRAW_DELAY_SEC) / config.blockTimeSec) + COMMIT_WINDOW_BLOCKS + DRAW_SAFETY_BLOCKS;
    const drawBlock = now + blocksUntilDraw;

    const pendingId = this.db.insertPendingCreation({
      creator_identity: p.creatorIdentity,
      host_wallet: hostWallet,
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

  handleGiveawayCreated(ev: {
    id: number; host: string; token: string; prize: bigint;
    winnerCount: number; rule: number; entryMode: number; drawBlock: number;
  }): GiveawayRow | null {
    if (this.db.getGiveaway(ev.id)) return null;
    const pending = this.db.findMatchingPendingCreation(
      ev.host, ev.token, ev.prize.toString(), ev.winnerCount, ev.rule, ev.entryMode, ev.drawBlock
    );
    if (!pending) return null;
    this.db.insertGiveaway({
      id: ev.id,
      chat_id: pending.chat_id,
      creator_identity: pending.creator_identity,
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
    identity: string,
    opts: { membershipOk: boolean; providedKey?: string }
  ): Promise<EnterResult> {
    const g = this.db.getGiveaway(giveawayId);
    if (!g || g.status !== "open") return { ok: false, reason: "not_open" };

    const user = this.db.getUser(identity);
    if (!user) return { ok: false, reason: "not_verified" };

    if (g.scope === "members" && !opts.membershipOk) return { ok: false, reason: "not_member" };
    if (g.scope === "private" && (opts.providedKey ?? "") !== (g.access_key ?? "")) return { ok: false, reason: "wrong_key" };

    if (Date.now() >= g.entries_close_at) return { ok: false, reason: "closed" };
    if (this.db.hasEntered(giveawayId, identity)) return { ok: false, reason: "already" };

    if (g.entry_mode === EntryMode.OnChainEnter) {
      const iface = new ethers.Interface(["function enter(uint256 id)"]);
      return {
        ok: true,
        mode: "onchain",
        action: { to: config.vaultAddress, value: "0", data: iface.encodeFunctionData("enter", [giveawayId]) },
      };
    }

    this.db.addEntry(giveawayId, identity, user.wallet, Date.now());
    return { ok: true, mode: "tap" };
  }

  // On-chain Entered event (OnChainEnter giveaways): record by wallet → identity.
  handleEntered(giveawayId: number, account: string): string | null {
    const user = this.db.getUserByWallet(account);
    if (!user) return null;
    this.db.addEntry(giveawayId, user.identity, ethers.getAddress(account), Date.now());
    return user.identity;
  }

  // ---- scheduler: commit off-chain entrants, then trigger resolve ----
  async tickDueGiveaways(): Promise<void> {
    const current = await this.chain.blockNumber();
    const now = Date.now();

    for (const g of this.db.listOpenGiveaways()) {
      if (g.entry_mode === EntryMode.OffChainTap && !g.committed && now >= g.entries_close_at && current < g.draw_block) {
        const entrants = this.db.getEntries(g.id).map((e) => e.wallet);
        if (entrants.length > 0) await this.chain.commitEntrants(g.id, entrants);
        this.db.setCommitted(g.id);
      }
      if (current > g.draw_block && (g.entry_mode === EntryMode.OnChainEnter || g.committed)) {
        await this.chain.resolve(g.id);
        this.db.setGiveawayStatus(g.id, "resolved");
      } else if (g.entry_mode === EntryMode.OffChainTap && !g.committed && current > g.draw_block) {
        console.warn(`[scheduler] giveaway ${g.id} missed its commit window; resolving to free funds`);
        await this.chain.resolve(g.id);
        this.db.setGiveawayStatus(g.id, "resolved");
      }
    }
  }

  // Resolved event → persist draw details and map winners to users for notifications.
  handleResolved(id: number, winners: string[], perWinnerWei: bigint, seed: string, txHash: string): ResolvedInfo | null {
    const g = this.db.getGiveaway(id);
    if (!g) return null;
    const checksummed = winners.map((w) => ethers.getAddress(w));
    this.db.setResolvedInfo(id, seed, txHash, perWinnerWei.toString(), JSON.stringify(checksummed));
    return {
      giveaway: this.db.getGiveaway(id)!,
      perWinnerWei,
      winners: checksummed.map((w) => {
        const u = this.db.getUserByWallet(w);
        return { address: w, identity: u?.identity };
      }),
    };
  }

  // ---- web-facing helpers (used by the HTTP API) ----
  startWebVerification(): { token: string; amountWei: bigint; verifier: string } {
    const token = randomBytes(16).toString("hex");
    const r = this.startVerification(`web:${token}`);
    return { token, amountWei: r.amountWei!, verifier: config.verifierAddress };
  }
  webStatus(token: string): { verified: boolean; wallet: string | null } {
    const w = this.walletOf(`web:${token}`);
    return { verified: !!w, wallet: w ?? null };
  }

  private toView(g: GiveawayRow) {
    return {
      id: g.id,
      token: g.token,
      prizeWei: g.prize_wei,
      winnerCount: g.winner_count,
      rule: g.rule,
      ruleLabel: RULE_LABEL[g.rule],
      scope: g.scope,
      entryMode: g.entry_mode,
      status: g.status,
      entriesCloseAt: g.entries_close_at,
      drawBlock: g.draw_block,
      entryCount: this.db.countEntries(g.id),
      winners: g.winners_json ? (JSON.parse(g.winners_json) as string[]) : null,
      perWinnerWei: g.per_winner_wei,
      seed: g.seed,
      resolveTx: g.resolve_tx,
    };
  }
  publicGiveaways() {
    return this.db.listPublicGiveaways().map((g) => this.toView(g));
  }
  giveawayView(id: number, providedKey?: string) {
    const g = this.db.getGiveaway(id);
    if (!g) return null;
    // Private giveaways are only viewable with the key.
    if (g.scope === "private" && (providedKey ?? "") !== (g.access_key ?? "")) return { locked: true as const };
    return this.toView(g);
  }
  drawView(id: number) {
    const g = this.db.getGiveaway(id);
    if (!g) return null;
    return {
      id,
      rule: g.rule,
      ruleLabel: RULE_LABEL[g.rule],
      winnerCount: g.winner_count,
      status: g.status,
      entrants: this.db.getEntries(id).map((e) => e.wallet),
      seed: g.seed,
      winners: g.winners_json ? (JSON.parse(g.winners_json) as string[]) : null,
      resolveTx: g.resolve_tx,
    };
  }
}
