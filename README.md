# FairSeat

**One Agent ID, one seat.** Participation infrastructure for Binance Agent ID holders on BNB Chain — community giveaways (and, next, votes) where each Agent ID counts once, with rewards locked on-chain and winners paid automatically.

> Built for the Binance Wallet × BNB Chain **Agent ID Hackathon**. Work in progress.

## How it works (short, honest)
- A Binance **Agent ID** is one-per-account and non-transferable (soulbound ERC-721 on BNB Chain). FairSeat uses it as a fair "seat": **one participation per Agent ID**. Sybil-resistance comes from Binance's KYC, not a cryptographic proof of personhood — FairSeat does not claim to prove humans.
- **Verify once:** a user adds the FairSeat Verifier contract to their Binance Address Book and sends one tiny transaction (a few cents of gas) from their Binance AI wallet. The contract confirms they hold an Agent ID, binds their account, and refunds the dust. After that, joining is a tap.
- **Locked rewards:** a host funds an on-chain vault before launch. No one — not even FairSeat — can withdraw early. Winners are paid automatically; leftovers return to the host.
- **Fair draws:** random winners are seeded from a future block hash with the entrant set committed beforehand, so anyone can recompute the result and no one can rig it.

## Repository layout
| Path | What |
| --- | --- |
| `contracts/` | Solidity contracts (Hardhat): Agent ID gating, giveaway vault, polls, batch distribution. |
| `bot/` | Telegram bot + chain-watcher backend (added in Phase A). |
| `web/` | Website surface (added in Phase B). |

## Status
- [x] M0 — scaffold, mock Agent ID registry, green build
- [ ] M1 — Verifier + GiveawayVault contracts + tests on BSC testnet
- [ ] M2–M3 — Telegram giveaway end-to-end
- [ ] Website, votes, CSV distribution

## Safety
No keys, seed phrases, or logins are ever requested. Every transaction is previewed and confirmed by the user in their own wallet. Contracts are open-source; owner permissions are documented.

## License
MIT
