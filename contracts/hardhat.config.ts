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
      // Default to the official BNB Chain dataseed. Some public nodes (e.g. publicnode)
      // return a contract-creation tx's `to` as "" instead of null, which makes
      // ethers v6 / hardhat-ethers throw BAD_DATA ("invalid value for value.to") while
      // reading back the deploy tx. Override with BSC_MAINNET_RPC if needed.
      url: process.env.BSC_MAINNET_RPC || "https://bsc-dataseed.bnbchain.org",
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
