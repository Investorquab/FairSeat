import { ethers } from "ethers";
import type { FairSeatDB } from "./db.js";

// The Binance Agentic Wallet `send` carries no memo field, so we encode a one-time nonce
// as a UNIQUE tiny amount. The backend matches the on-chain `Verified(account, amount)`
// event to a pending session by that exact amount.
//
// amount = BASE (0.0001) + random(0..~0.0000999999) with 1e8-wei granularity.
const BASE = 100_000_000_000_000n; // 0.0001 ether
const STEP = 100_000_000n; // 1e8 wei granularity (keeps the decimal short-ish)

export function generateVerifyAmount(db: FairSeatDB): bigint {
  for (let i = 0; i < 100; i++) {
    const rand = BigInt(Math.floor(Math.random() * 999_999) + 1); // 1..999999
    const amount = BASE + rand * STEP;
    if (!db.amountInUse(amount.toString())) return amount;
  }
  throw new Error("could not allocate a unique verification amount");
}

export function formatAmount(wei: bigint): string {
  return ethers.formatEther(wei);
}

export interface VerificationMatch {
  telegramId: number;
  wallet: string;
}

// Called when a `Verified` event is seen on-chain. Returns the bound Telegram user, or null
// if the amount doesn't match any pending session (e.g. someone verified without the bot).
export function matchVerification(
  db: FairSeatDB,
  account: string,
  amountWei: bigint,
  now: number
): VerificationMatch | null {
  const session = db.getPendingSessionByAmount(amountWei.toString());
  if (!session) return null;

  const wallet = ethers.getAddress(account); // checksum
  db.bindUser(session.telegram_id, wallet, now);
  db.markSessionVerified(session.id);
  return { telegramId: session.telegram_id, wallet };
}
