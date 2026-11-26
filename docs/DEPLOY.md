# Deploy & hosting

How to deploy FairSeat to **BNB Chain mainnet**, verify the contracts on BscScan, and host the
backend + website.

## Prerequisites

- Node 22+ and `pnpm`.
- A **deployer wallet** with a little BNB (for contract deployment gas).
- An **operator wallet** with a little BNB — FairSeat's backend wallet (commits off-chain-tap
  entrants/votes; can never move funds). Can be the same as the deployer, but a dedicated key is
  cleaner.
- A **BscScan API key** (free) for source verification.
- A **Telegram bot token** from @BotFather (only if you run the Telegram bot).

`pnpm install` at the repo root first.

## 1. Deploy the contracts

```bash
cd contracts
cp .env.example .env     # set DEPLOYER_KEY, BSCSCAN_API_KEY, and OPERATOR_ADDRESS
pnpm hardhat run scripts/deploy.ts --network bscMainnet
```

On mainnet the script automatically uses the **real Agent ID registry**
(`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`) — it never deploys a mock. It prints the deployed
addresses and writes them to `contracts/deployments/bscMainnet.json`.

## 2. Verify the source on BscScan

A verified, open-source contract is required. For each deployed contract:

```bash
# Verifier(registry)
pnpm hardhat verify --network bscMainnet <VERIFIER> 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
# GiveawayVault(registry, operator)  and  Poll(registry, operator)
pnpm hardhat verify --network bscMainnet <VAULT> 0x60B9...022f <OPERATOR>
pnpm hardhat verify --network bscMainnet <POLL>  0x60B9...022f <OPERATOR>
# BatchDistributor(registry)
pnpm hardhat verify --network bscMainnet <DISTRIBUTOR> 0x60B9...022f
```

Put the mainnet addresses into the README's address table.

## 3. Configure the backend

```bash
cd ../bot
cp .env.example .env
```

Fill `.env`: `CHAIN_ID=56`, a mainnet `RPC_URL`, the four FairSeat addresses from step 1,
`REGISTRY_ADDRESS` (the real registry), `OPERATOR_KEY` (funded with BNB), `BLOCK_TIME_SEC=0.75`, and
`BOT_TOKEN` if using Telegram.

```bash
pnpm build            # compile to dist/
node --experimental-sqlite dist/index.js   # or: pnpm dev (tsx)
```

The process runs the **API + chain-watcher** always, and the **Telegram bot** when `BOT_TOKEN` is
set. It uses long-polling, so no inbound webhook/public URL is needed for Telegram.

## 4. Build & host the website

```bash
cd ../web
pnpm build            # outputs static files to web/dist/
```

Serve `web/dist/` with any web server, and reverse-proxy `/api` to the backend's `API_PORT` so the
site and API share an origin (then the site needs no extra config). Example nginx:

```nginx
server {
  server_name fairseat.example;
  root /var/www/fairseat/web/dist;
  location / { try_files $uri /index.html; }
  location /api/ { proxy_pass http://127.0.0.1:8787; }
}
```

## 5. Running it on a VPS (persistent)

- Run the backend as a managed service (pm2 or a systemd unit) from the `bot/` directory, with its
  `.env` present and the SQLite `DB_PATH` on a persistent disk. Restart on reboot.
- Keep the operator key only in the backend's environment, never in the repo.
- The website is static — build it and let nginx serve `web/dist` with the `/api` proxy above.
- Node 22's `node:sqlite` is used, so run the backend with `--experimental-sqlite`.

### Notes for an agent setting this up
The only long-running process is the backend (`bot/`), which needs: Node 22+, the `.env`, outbound
HTTPS to the RPC + `api.telegram.org`, and a writable `DB_PATH`. The frontend is static. There is no
database server and no inbound webhook to configure.
