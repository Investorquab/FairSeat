import "dotenv/config";

const chainId = Number(process.env.CHAIN_ID ?? "97");

export const config = {
  botToken: process.env.BOT_TOKEN ?? "",
  chainId,
  rpcUrl: process.env.RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com",
  registryAddress: process.env.REGISTRY_ADDRESS ?? "",
  verifierAddress: process.env.VERIFIER_ADDRESS ?? "",
  vaultAddress: process.env.VAULT_ADDRESS ?? "",
  operatorKey: process.env.OPERATOR_KEY ?? "",
  dbPath: process.env.DB_PATH ?? "./fairseat.db",
  explorer: chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com",
  nativeSymbol: chainId === 56 ? "BNB" : "tBNB",
};

export function assertChainConfig(): void {
  for (const k of ["verifierAddress", "vaultAddress", "registryAddress", "rpcUrl"] as const) {
    if (!config[k]) throw new Error(`Missing chain config: ${k}`);
  }
}
