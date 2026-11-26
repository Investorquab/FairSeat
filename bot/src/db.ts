import { DatabaseSync } from "node:sqlite";

// Minimal typed wrapper around the local SQLite store.
// Holds: verified Telegram<->wallet bindings, verification sessions, a mirror of giveaways
// created via the bot, and off-chain-tap entries. The money truth lives on-chain; this DB
// is operational state + what we publish for audit. It never holds any private key.

export interface UserRow {
  telegram_id: number;
  wallet: string;
  verified_at: number;
}

export interface VerifySessionRow {
  id: number;
  telegram_id: number;
  amount_wei: string;
  status: "pending" | "verified" | "expired";
  created_at: number;
}

export interface GiveawayRow {
  id: number; // on-chain giveaway id
  chat_id: number;
  creator_telegram_id: number;
  token: string;
  prize_wei: string;
  winner_count: number;
  rule: number; // 0 FirstN, 1 Random, 2 SplitEqually
  entry_mode: number; // 0 OffChainTap, 1 OnChainEnter
  scope: "members" | "public" | "private";
  access_key: string | null;
  entries_close_at: number; // wall-clock ms; entries accepted until then
  draw_block: number;
  status: "open" | "resolved" | "cancelled";
  committed: number; // 0/1 — off-chain-tap entrants pushed on-chain before the draw
  announce_chat_id: number | null;
  announce_message_id: number | null;
  created_at: number;
}

export interface EntryRow {
  giveaway_id: number;
  telegram_id: number;
  wallet: string;
  created_at: number;
}

// A giveaway configured in the bot but not yet funded on-chain. When the host signs the
// createGiveaway tx, the watcher matches the GiveawayCreated event back to one of these.
export interface PendingCreationRow {
  id: number;
  creator_telegram_id: number;
  host_wallet: string;
  chat_id: number;
  token: string;
  prize_wei: string;
  winner_count: number;
  rule: number;
  entry_mode: number;
  scope: "members" | "public" | "private";
  access_key: string | null;
  entries_close_at: number;
  draw_block: number;
  matched: number;
  created_at: number;
}

export class FairSeatDB {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id INTEGER PRIMARY KEY,
        wallet      TEXT NOT NULL UNIQUE,
        verified_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS verify_sessions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER NOT NULL,
        amount_wei  TEXT NOT NULL UNIQUE,
        status      TEXT NOT NULL DEFAULT 'pending',
        created_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS giveaways (
        id                  INTEGER PRIMARY KEY,
        chat_id             INTEGER NOT NULL,
        creator_telegram_id INTEGER NOT NULL,
        token               TEXT NOT NULL,
        prize_wei           TEXT NOT NULL,
        winner_count        INTEGER NOT NULL,
        rule                INTEGER NOT NULL,
        entry_mode          INTEGER NOT NULL,
        scope               TEXT NOT NULL,
        access_key          TEXT,
        entries_close_at    INTEGER NOT NULL,
        draw_block          INTEGER NOT NULL,
        status              TEXT NOT NULL DEFAULT 'open',
        committed           INTEGER NOT NULL DEFAULT 0,
        announce_chat_id    INTEGER,
        announce_message_id INTEGER,
        created_at          INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entries (
        giveaway_id INTEGER NOT NULL,
        telegram_id INTEGER NOT NULL,
        wallet      TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (giveaway_id, telegram_id)
      );
      CREATE TABLE IF NOT EXISTS pending_creations (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_telegram_id INTEGER NOT NULL,
        host_wallet         TEXT NOT NULL,
        chat_id             INTEGER NOT NULL,
        token               TEXT NOT NULL,
        prize_wei           TEXT NOT NULL,
        winner_count        INTEGER NOT NULL,
        rule                INTEGER NOT NULL,
        entry_mode          INTEGER NOT NULL,
        scope               TEXT NOT NULL,
        access_key          TEXT,
        entries_close_at    INTEGER NOT NULL,
        draw_block          INTEGER NOT NULL,
        matched             INTEGER NOT NULL DEFAULT 0,
        created_at          INTEGER NOT NULL
      );
    `);
  }

  // ---- users ----
  getUserByTelegram(telegramId: number): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId) as UserRow | undefined;
  }
  getUserByWallet(wallet: string): UserRow | undefined {
    return this.db
      .prepare("SELECT * FROM users WHERE wallet = ? COLLATE NOCASE")
      .get(wallet) as UserRow | undefined;
  }
  bindUser(telegramId: number, wallet: string, verifiedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO users (telegram_id, wallet, verified_at) VALUES (?, ?, ?)
         ON CONFLICT(telegram_id) DO UPDATE SET wallet = excluded.wallet, verified_at = excluded.verified_at`
      )
      .run(telegramId, wallet, verifiedAt);
  }

  // ---- verify sessions ----
  createVerifySession(telegramId: number, amountWei: string, createdAt: number): VerifySessionRow {
    const info = this.db
      .prepare("INSERT INTO verify_sessions (telegram_id, amount_wei, created_at) VALUES (?, ?, ?)")
      .run(telegramId, amountWei, createdAt);
    return this.db
      .prepare("SELECT * FROM verify_sessions WHERE id = ?")
      .get(Number(info.lastInsertRowid)) as unknown as VerifySessionRow;
  }
  getPendingSessionByAmount(amountWei: string): VerifySessionRow | undefined {
    return this.db
      .prepare("SELECT * FROM verify_sessions WHERE amount_wei = ? AND status = 'pending'")
      .get(amountWei) as VerifySessionRow | undefined;
  }
  amountInUse(amountWei: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM verify_sessions WHERE amount_wei = ? AND status = 'pending'")
      .get(amountWei);
  }
  markSessionVerified(id: number): void {
    this.db.prepare("UPDATE verify_sessions SET status = 'verified' WHERE id = ?").run(id);
  }

  // ---- giveaways ----
  insertGiveaway(g: Omit<GiveawayRow, "status" | "committed" | "announce_chat_id" | "announce_message_id">): void {
    this.db
      .prepare(
        `INSERT INTO giveaways
         (id, chat_id, creator_telegram_id, token, prize_wei, winner_count, rule, entry_mode, scope, access_key, entries_close_at, draw_block, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
      )
      .run(
        g.id, g.chat_id, g.creator_telegram_id, g.token, g.prize_wei, g.winner_count,
        g.rule, g.entry_mode, g.scope, g.access_key, g.entries_close_at, g.draw_block, g.created_at
      );
  }
  getGiveaway(id: number): GiveawayRow | undefined {
    return this.db.prepare("SELECT * FROM giveaways WHERE id = ?").get(id) as GiveawayRow | undefined;
  }
  setGiveawayStatus(id: number, status: GiveawayRow["status"]): void {
    this.db.prepare("UPDATE giveaways SET status = ? WHERE id = ?").run(status, id);
  }
  setCommitted(id: number): void {
    this.db.prepare("UPDATE giveaways SET committed = 1 WHERE id = ?").run(id);
  }
  setAnnounce(id: number, chatId: number, messageId: number): void {
    this.db
      .prepare("UPDATE giveaways SET announce_chat_id = ?, announce_message_id = ? WHERE id = ?")
      .run(chatId, messageId, id);
  }
  listOpenGiveaways(): GiveawayRow[] {
    return this.db.prepare("SELECT * FROM giveaways WHERE status = 'open'").all() as unknown as GiveawayRow[];
  }

  // ---- entries ----
  addEntry(giveawayId: number, telegramId: number, wallet: string, createdAt: number): boolean {
    try {
      this.db
        .prepare("INSERT INTO entries (giveaway_id, telegram_id, wallet, created_at) VALUES (?, ?, ?, ?)")
        .run(giveawayId, telegramId, wallet, createdAt);
      return true;
    } catch {
      return false; // already entered (PK conflict)
    }
  }
  hasEntered(giveawayId: number, telegramId: number): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM entries WHERE giveaway_id = ? AND telegram_id = ?")
      .get(giveawayId, telegramId);
  }
  getEntries(giveawayId: number): EntryRow[] {
    return this.db
      .prepare("SELECT * FROM entries WHERE giveaway_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(giveawayId) as unknown as EntryRow[];
  }

  // ---- pending creations ----
  insertPendingCreation(p: Omit<PendingCreationRow, "id" | "matched">): number {
    const info = this.db
      .prepare(
        `INSERT INTO pending_creations
         (creator_telegram_id, host_wallet, chat_id, token, prize_wei, winner_count, rule, entry_mode, scope, access_key, entries_close_at, draw_block, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        p.creator_telegram_id, p.host_wallet, p.chat_id, p.token, p.prize_wei, p.winner_count,
        p.rule, p.entry_mode, p.scope, p.access_key, p.entries_close_at, p.draw_block, p.created_at
      );
    return Number(info.lastInsertRowid);
  }
  findMatchingPendingCreation(
    hostWallet: string, token: string, prizeWei: string, winnerCount: number,
    rule: number, entryMode: number, drawBlock: number
  ): PendingCreationRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM pending_creations
         WHERE matched = 0 AND host_wallet = ? COLLATE NOCASE AND token = ? COLLATE NOCASE
           AND prize_wei = ? AND winner_count = ? AND rule = ? AND entry_mode = ? AND draw_block = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(hostWallet, token, prizeWei, winnerCount, rule, entryMode, drawBlock) as PendingCreationRow | undefined;
  }
  markPendingMatched(id: number): void {
    this.db.prepare("UPDATE pending_creations SET matched = 1 WHERE id = ?").run(id);
  }

  close(): void {
    this.db.close();
  }
}
