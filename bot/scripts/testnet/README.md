# Testnet dev / demo scripts

Manual helpers used to build, seed, and end-to-end test FairSeat against **BNB testnet**.
They are NOT part of the production runtime (that is `src/`). They assume a funded throwaway
deployer/operator key and the testnet contract addresses in `../../contracts/deployments/`.

- `live-verify.ts` — watcher detects a real `Verified` event and binds an account.
- `live-giveaway.ts` — full create → announce → enter → commit → resolve → winner flow.
- `complete-verify.ts` / `fund-giveaway.ts` / `watch-resolve.ts` — drive individual steps from the backend during a manual demo.
- `seed-web.ts` / `seed-poll.ts` — populate demo giveaways / a demo poll.

Run from the `bot/` directory, e.g.:
`node --experimental-sqlite --import tsx scripts/testnet/live-giveaway.ts`
