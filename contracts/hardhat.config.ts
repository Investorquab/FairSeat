import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const DEPLOYER_KEY = process.env.DEPLOYER_KEY;
const accounts = DEPLOYER_KEY ? [DEPLOYER_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Local in-memory network for unit tests (default).
    hardhat: {},
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com",
      chainId: 97,
      accounts,
    },
    bscMainnet: {
      url: process.env.BSC_MAINNET_RPC || "https://bsc-rpc.publicnode.com",
      chainId: 56,
      accounts,
    },
  },
  // Used by `hardhat verify` to publish source on BscScan.
  etherscan: {
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
    },
  },
};

export default config;
