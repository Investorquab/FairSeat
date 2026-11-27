import { ethers } from "ethers";
import type { FairSeatDB } from "./db.js";

// The Binance Agentic Wallet `send` carries no memo field, so we encode a one-time nonce
// as a UNIQUE tiny amount. The backend matches the on-chain `Verified(account, amount)`
// event to a pending session by that exact amount.
//
// amount = BASE (0.00001) + random(0..~0.0000099999) with 1e8-wei granularity. Kept small so the
// dust a user sends is ~0.00001–0.00002 BNB (about a cent) while staying unique enough to match.
const BASE = 10_000_000_000_000n; // 0.00001 ether
const STEP = 100_000_000n; // 1e8 wei granularity (keeps the decimal short-ish)

// A pending verification is only matchable for this long, limiting the window in which its
// (user-private) dust amount is live (F-4 mitigation).
export const VERIFY_TTL_MS = 60 * 60 * 1000;

export function generateVerifyAmount(db: FairSeatDB): bigint {
  for (let i = 0; i < 100; i++) {
    const rand = BigInt(Math.floor(Math.random() * 99_999) + 1); // 1..99999
    const amount = BASE + rand * STEP;
    if (!db.amountInUse(amount.toString())) return amount;
  }
  throw new Error("could not allocate a unique verification amount");
}

export function formatAmount(wei: bigint): string {
  return ethers.formatEther(wei);
}

export interface VerificationMatch {
  identity: string;
  wallet: string;
}

// Called when a `Verified` event is seen on-chain. Returns the bound user identity, or null
// if the amount doesn't match any pending session (e.g. someone verified without us).
export function matchVerification(
  db: FairSeatDB,
  account: string,
  amountWei: bigint,
  now: number
): VerificationMatch | null {
  const session = db.getPendingSessionByAmount(amountWei.toString());
  if (!session) return null;
  if (now - session.created_at > VERIFY_TTL_MS) {
    db.markSessionExpired(session.id);
    return null;
  }

  const wallet = ethers.getAddress(account); // checksum
  db.bindUser(session.identity, wallet, now);
  db.markSessionVerified(session.id);
  return { identity: session.identity, wallet };
}
