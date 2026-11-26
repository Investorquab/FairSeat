import "dotenv/config";

const chainId = Number(process.env.CHAIN_ID ?? "97");

export const config = {
  botToken: process.env.BOT_TOKEN ?? "",
  chainId,
  rpcUrl: process.env.RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com",
  registryAddress: process.env.REGISTRY_ADDRESS ?? "",
  verifierAddress: process.env.VERIFIER_ADDRESS ?? "",
  vaultAddress: process.env.VAULT_ADDRESS ?? "",
  pollAddress: process.env.POLL_ADDRESS ?? "",
  operatorKey: process.env.OPERATOR_KEY ?? "",
  dbPath: process.env.DB_PATH ?? "./fairseat.db",
  explorer: chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com",
  nativeSymbol: chainId === 56 ? "BNB" : "tBNB",
  // Average seconds per block for this network, used to place the draw block safely after
  // the (wall-clock) entry window. BSC testnet ~0.45s; mainnet ~0.75s. Override per network.
  blockTimeSec: Number(process.env.BLOCK_TIME_SEC ?? (chainId === 56 ? "0.75" : "0.45")),
};

export function assertChainConfig(): void {
  for (const k of ["verifierAddress", "vaultAddress", "registryAddress", "rpcUrl"] as const) {
    if (!config[k]) throw new Error(`Missing chain config: ${k}`);
  }
}
