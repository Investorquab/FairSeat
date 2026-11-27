# FairSeat - internal security audit

**Date:** 2026-11-26 · **Scope:** this repository + the BNB **testnet** deployment. No mainnet or
production deployment existed at audit time. **Method:** attacker-minded review of the contracts and
backend in the order identity/ownership → money → external trust, with each confirmed issue fixed and
covered by a regression test that fails before the fix and passes after. Single-reviewer (this
assistant); no third-party audit - treat as **internally audited**, not independently audited.

## Summary

| # | Severity | Area | Status |
| --- | --- | --- | --- |
| F-1 | Medium | GiveawayVault - payout DoS / fund-lock | **Fixed** + regression test |
| F-2 | Medium | BatchDistributor - batch DoS | **Fixed** + regression test |
| F-3 | Medium | Backend - verification availability / seat integrity | **Fixed** + regression test |
| F-4 | Low | Backend - verification binding uses a user-private amount | Mitigated (TTL); residual low |
| F-5 | Low | GiveawayVault - late-resolve seed grinding | Documented; primary path avoids |
| F-6 | Low | API - no rate limiting | **Fixed** (per-IP limit) + proxy guidance |

No Critical or High findings. No way was found to steal locked funds, to withdraw as a non-host, to
get more than one seat per Agent ID, or to make the bot sign for a user.

## What was checked
- **Identity / ownership:** verify-once binding, the one-wallet-one-seat invariant, the `operator`
  role, Telegram callback authenticity, API session tokens, `/api/*/prepare` authorization.
- **Money:** `GiveawayVault` (lock, resolve, cancel, refund, randomness, reentrancy),
  `BatchDistributor`, `FairSeatVerifier` refund, token (BEP-20) handling.
- **External trust:** on-chain event matching in the watcher, client input to the API, SQL access.

## Findings

### F-1 · Medium · GiveawayVault payout DoS → fund-lock
`resolve` pushed the prize to each winner and **reverted** on any failed transfer. A winner whose
wallet rejects native funds (a contract with a reverting `receive`) would make `resolve` revert
forever; since the winner set is fixed by the draw-block seed, the giveaway's funds could never be
paid out or recovered - a griefing / denial-of-service that locks funds (not theft).
**Fix:** best-effort payouts - a winner transfer that fails is skipped (its share returns to the host
as leftover) instead of reverting the whole resolution.
**Re-verified:** test *"a winner that rejects funds is skipped, not a DoS"* (a `RejectingReceiver`
Agent-ID holder is a winner; `resolve` succeeds, the other winner is paid, the skipped share returns
to the host, the vault empties).

### F-2 · Medium · BatchDistributor batch DoS
`distribute` paid each recipient and reverted on any failed transfer, so a single recipient that
rejects funds would fail the entire batch.
**Fix:** best-effort per recipient - a failed transfer is skipped and its share refunded to the
sender with everything else.
**Re-verified:** test *"a recipient that rejects funds is skipped + refunded, not a DoS"*.

### F-3 · Medium · Verification availability & seat integrity
Two backend issues: (a) `verify_sessions.amount_wei` had a **global UNIQUE** constraint while the
dust amount is drawn from a bounded range and only pending reuse was checked - so as verifications
accumulate, `startVerification` could throw on an amount equal to a past (verified) session, a growing
availability failure; (b) `bindUser` upserted on identity while `users.wallet` is UNIQUE, so
re-verifying a wallet under a new identity threw **inside the watcher** (unhandled).
**Fix:** pending-only uniqueness (dropped the global UNIQUE, added a lookup index), and a safe
`bindUser` that re-points a wallet to the latest identity (preserving one-wallet-one-seat) without
ever violating the unique constraint.
**Re-verified:** tests *"re-binding a wallet to a new identity never throws"* and that reusing a past
amount across sessions no longer throws.

### F-4 · Low · Verification binding uses a user-private amount
The backend matches the on-chain `Verified` event to a session by the unique dust **amount**, which is
a per-session value shown only to that user. Anyone who learned a pending amount could send it first
and bind the victim's session to their own wallet. In normal use the amount is private, so this is
low risk.
**Mitigation:** pending sessions now expire after 60 minutes (shrinking the live window); the amount
remains a per-user secret. **Residual:** a leaked pending amount within the window.

### F-5 · Low · Late-resolve seed grinding
If `resolve` runs more than 256 blocks after the draw block (its primary block hash gone), it falls
back to a recent block hash so funds never get stuck - but a permissionless caller could then grind
the timing. The backend resolves promptly, so the primary (un-grindable) path is the norm. Documented
in the contract; residual risk only when resolution is very late.

### F-6 · Low · No API rate limiting
The HTTP API had no built-in rate limiting, so write endpoints (`verify/start`, `prepare`, `vote`,
`enter`) could be spammed (junk rows, resource use). No funds or integrity at risk.
**Fix:** a per-IP sliding-window limit (40 write requests/minute) on POST endpoints, returning 429.
Production should also rate-limit at the reverse proxy (see `docs/DEPLOY.md`).

## Hardening also applied
- `createGiveaway` marked `nonReentrant` (defensive; `resolve`/`cancel`/`distribute` already were).

## Not tested / residual
- No third-party/independent audit; no formal verification; no fuzzing campaign.
- Randomness is block-hash based (not a VRF) - acceptable for community giveaways and documented;
  a block producer can bias a single block hash.
- Sybil-resistance equals Binance's KYC (one Agent ID per account), which is off-chain - FairSeat
  does not claim to prove personhood.
- The testnet contracts were deployed before these fixes; the **mainnet** deployment will use the
  fixed code in this commit.

## Re-run the audit's tests
```bash
cd contracts && pnpm hardhat test    # includes F-1, F-2 regression tests (24 passing)
cd ../bot && pnpm test               # includes F-3, F-4 regression tests (9 passing)
```
