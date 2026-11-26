# FairSeat — one Agent ID, one seat

Participation infrastructure for **Binance Agent ID** holders on **BNB Chain**. FairSeat makes every
giveaway, vote, and payout count each Agent ID **once** — rewards are locked on-chain, winners are
drawn provably-fair, and every result is checkable by anyone.

> Built for the Binance Wallet × BNB Chain **Agent ID Hackathon**.

## Why

Crypto giveaways, airdrops and polls are broken by multi-wallet farming: one person with 50 wallets
takes 50 entries, 50 votes, 50 claims. A **Binance Agent ID** is **one per Binance account** and
**non-transferable** (a soulbound ERC-721). FairSeat uses it as a fair "seat": one participation per
Agent ID. Sybil-resistance comes from Binance's KYC — FairSeat does **not** claim to prove humans, and
it cannot stop someone running several real Binance accounts. It makes multi-wallet farming
much harder, and makes every outcome publicly verifiable.

## What it does

| Feature | What |
| --- | --- |
| **Verify once** | A user sends one tiny transaction from their Binance AI wallet; FairSeat confirms they hold an Agent ID and links their account. No keys, no login, dust refunded. After that, joining is a tap. |
| **Giveaways** | A host funds an on-chain vault; nobody (not even FairSeat) can withdraw it early. Winners by random draw / first-N / split-equally, paid automatically; leftovers returned to the host. |
| **Votes** | One Agent ID, one vote. Open, on-chain tallies that can't be brigaded with fake wallets. |
| **CSV distribution** | Paste a list of addresses + amounts and pay the whole list in one transaction — only real Agent-ID holders are paid; the rest are skipped and refunded. |

Runs as a **Telegram bot**, a **website**, and **on-chain contracts** on BNB Chain.

## How the fairness works (honest)

- **One seat:** every payout and vote checks `registry.balanceOf(address) > 0` against the Agent ID
  registry. Soulbound ⇒ one Agent ID per address; one-per-person rests on Binance KYC, off-chain.
- **Can't be rugged:** giveaway funds are locked in the vault and only leave to winners (who hold an
  Agent ID) or back to the host. There is no admin that can take them.
- **Provably-fair draws:** random winners come from a **future block hash**, with the entrant set
  fixed before that block exists — so anyone can recompute the winners and no one can re-roll. The
  website's "Verify a draw" page does exactly this in your browser.

## Repository layout

| Path | What |
| --- | --- |
| [`contracts/`](contracts) | Solidity contracts + Hardhat tests + deploy script. |
| [`bot/`](bot) | Backend: Telegram bot + HTTP API + chain-watcher (one engine, `tg:` and `web:` identities). |
| [`web/`](web) | Website (Vite + React). |
| [`docs/`](docs) | [Architecture](docs/ARCHITECTURE.md) · [Deploy & hosting](docs/DEPLOY.md) · [Owner permissions](docs/OWNER-PERMISSIONS.md) |

### Contracts

| Contract | Role |
| --- | --- |
| `FairSeatVerifier` | Verify-once by a tiny self-send; checks Agent ID, refunds the dust. |
| `GiveawayVault` | Locks the reward; provably-fair payout to Agent-ID winners; leftover to host. |
| `Poll` | One Agent ID, one vote; public on-chain tally. |
| `BatchDistributor` | Pay a verified list in one tx; non-holders skipped and refunded. |

`MockAgentIdRegistry` and `MockERC20` under `contracts/contracts/mocks/` are **test-only** fixtures;
they are never deployed to mainnet (the deploy script uses the real registry on chain 56).

**Deployed addresses** (fill after deploying):

| Network | Registry | Verifier | GiveawayVault | Poll | BatchDistributor |
| --- | --- | --- | --- | --- | --- |
| BNB mainnet (56) | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` | `TBD` | `TBD` | `TBD` | `TBD` |

## Owner permissions (disclosed)

FairSeat has **no owner that can move user funds**. The only privileged role is an immutable
`operator` on the vault and poll, which can **only** submit off-chain-tap entrants/votes and is
checked on-chain; it can never withdraw, mint, pause, or take funds. Full disclosure:
[docs/OWNER-PERMISSIONS.md](docs/OWNER-PERMISSIONS.md).

## Develop

```bash
pnpm install

# contracts
cd contracts && pnpm test          # 22 tests on the local Hardhat network

# backend (bot + API + watcher)
cd ../bot && cp .env.example .env   # fill it in
pnpm test                           # backend unit tests
pnpm dev                            # run the bot + API

# website
cd ../web && pnpm dev               # Vite dev server (proxies /api to the backend)
```

See [docs/DEPLOY.md](docs/DEPLOY.md) to deploy the contracts to BNB Chain, verify them on BscScan,
and host the backend + site.

## Safety

No keys, seed phrases, or logins are ever requested. Every transaction is previewed and confirmed by
the user in their own wallet. FairSeat never stores wallet sessions or signs on a user's behalf. All
contracts are open-source and verified on BscScan.

## License

[MIT](LICENSE)
