import { ethers } from "ethers";
import type { FairSeatDB } from "./db.js";

// The Binance Agentic Wallet `send` carries no memo field, so we encode a one-time nonce
// as a UNIQUE tiny amount. The backend matches the on-chain `Verified(account, amount)`
// event to a pending session by that exact amount.
//
// IMPORTANT: the Binance wallet only lets you type up to 8 decimal places, so every amount we
// ask for must be expressible in <= 8 decimals, i.e. a whole number of 1e10-wei units
// (0.00000001 BNB). We pick one in 0.00001000 .. 0.00009999 BNB: tiny, refunded, always typeable.
const UNIT = 10_000_000_000n; // 1e10 wei = 0.00000001 BNB (the 8th decimal; finest the wallet accepts)
const MIN_UNITS = 1_000n; // floor: 0.00001 BNB
const SPAN = 9_000; // distinct amounts: 0.00001000 .. 0.00009999 BNB

// A pending verification is only matchable for this long, limiting the window in which its
// (user-private) dust amount is live (F-4 mitigation).
export const VERIFY_TTL_MS = 60 * 60 * 1000;

export function generateVerifyAmount(db: FairSeatDB): bigint {
  for (let i = 0; i < 200; i++) {
    const units = MIN_UNITS + BigInt(Math.floor(Math.random() * SPAN)); // 1000..9999
    const amount = units * UNIT; // always <= 8 decimal places
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
