# Owner permissions

FairSeat's contracts are deliberately minimal. **There is no owner, admin, or role that can move,
withdraw, mint, pause, or freeze user funds.** None of the contracts are upgradeable or behind a
proxy. The only privileged address is an immutable `operator`, and its powers are strictly limited
and checked on-chain.

## `FairSeatVerifier`
- **No owner, no admin, no privileged function.** It only accepts a dust transfer, checks the sender
  holds an Agent ID, emits `Verified`, and refunds the dust. It never holds funds.

## `GiveawayVault`
- **No owner.** Not upgradeable. No mint / pause / fee / freeze / withdraw function.
- `operator` - set once in the constructor, immutable. Its **only** power is `commitEntrants(id,
  addresses)`, which submits the entrants of an **off-chain-tap** giveaway, and only **before the
  draw block**. It cannot move funds, cannot change a giveaway's terms, and cannot change who wins
  beyond supplying the entrant set (every paid winner is still checked `balanceOf > 0` at payout, and
  the random selection is fixed by the future block hash).
- `resolve(id)` is **permissionless** - anyone may trigger the draw/payout after the draw block.
- The **host** (whoever funds a giveaway) may `cancel` it **only before anyone has entered**, and
  otherwise only receives leftovers automatically at `resolve`. A host cannot reclaim a prize once
  people have entered.

## `Poll`
- **No owner, no funds.** Not upgradeable.
- `operator` - immutable. Its **only** power is `commitVotes(id, voters, options)` for an
  **off-chain-tap** poll, before close. Each submitted vote is checked `balanceOf > 0` and
  deduplicated on-chain; it cannot alter already-cast votes or on-chain votes.
- `vote(id, option)` is open to any Agent-ID holder (on-chain polls).

## `BatchDistributor`
- **No owner, no admin, no stored funds.** `distribute` is initiated by the caller, is atomic, pays
  only Agent-ID holders, and refunds the remainder to the caller in the same transaction.

## The operator key

The `operator` is FairSeat's own backend wallet. It exists so that normal users can enter/vote with a
frictionless tap (the backend batches those on-chain just before the deadline) instead of each paying
gas. Compromise of the operator key cannot drain funds - the worst case is a wrongly-submitted
entrant/vote set for off-chain-tap events, which are published for audit. It should still be kept
secret and funded with only a little BNB for gas.
