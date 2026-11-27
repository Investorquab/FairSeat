# Architecture

FairSeat splits every feature into **on-chain money guarantees** and an **off-chain engine** for the
things a contract can't see.

```
  Telegram  ─┐                           ┌─ GiveawayVault  (locked funds, provably-fair payout)
  Website   ─┼─ FairSeat backend ──────── ┤─ Poll            (one Agent ID, one vote, on-chain tally)
             │  (bot + API + watcher)     ├─ BatchDistributor(verified batch payout)
             │                            └─ FairSeatVerifier (verify-once)
             └── one SQLite store         against: Agent ID registry (balanceOf gate)
```

## What lives where

- **On-chain (the contracts):** the money and the trust guarantees - funds locked, winners hold an
  Agent ID (`balanceOf > 0`), each paid once, leftovers returned, random draw seeded by a future
  block hash, votes one-per-Agent-ID.
- **Off-chain (the backend):** everything a contract can't read - Telegram group membership, access
  keys, "late-joiner" rules, and the frictionless tap flow. For off-chain-tap events, the backend
  collects taps and commits the entrant/vote set on-chain just before the deadline (one tx instead of
  one per user). All of this is published for audit.

## Identity

A user is a generic **identity** string so one engine serves both surfaces:
- Telegram: `tg:<telegram_id>`
- Website: `web:<random session token>`

Verification binds an identity to the wallet that holds the Agent ID. On-chain, only the wallet
matters (`balanceOf`); the identity is operational state.

## Verify-once

A user sends a tiny transaction from their Binance AI wallet to `FairSeatVerifier`. The contract
checks `balanceOf(sender) > 0`, emits `Verified(sender, amount)`, and refunds the dust. The backend
watches for that event and matches the unique dust `amount` to the pending session, binding the
identity ↔ wallet. This uses only a plain transfer (no `personal_sign`/EIP-191, which Agentic Wallets
don't support, and no QR/login sessions, which the hackathon rules forbid).

## Entry / vote modes

Both giveaways and polls support two modes:
- **Off-chain tap** (frictionless): the user taps; the backend records it and commits the set
  on-chain before the deadline. The entrant set is FairSeat-attested but published; the *draw* is
  still provably fair.
- **On-chain** (fully trustless): the user sends the entry/vote themselves; the set and tally are
  entirely on-chain.

## The watcher

A single polling loop reads the chain through the RPC and drives everything: it detects `Verified`,
`GiveawayCreated`, `Entered`, `Resolved`, `PollCreated`, and `Voted`, binds/records them, and runs
the scheduler that commits off-chain-tap sets and resolves due giveaways. It works over plain HTTP
RPC (no WebSockets), so it runs anywhere.

## Backend components (`bot/src`)

`config` · `db` (SQLite) · `chain` (ethers provider + contracts) · `verify` · `service` (all business
logic, framework-independent) · `watcher` · `bot` (grammY) · `api` (HTTP) · `index` (wires it up: the
API + watcher always run; the Telegram bot runs when `BOT_TOKEN` is set).
