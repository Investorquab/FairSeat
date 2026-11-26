import { ethers, network } from "hardhat";

// The real Binance / SPACE ID Agent ID registry on BNB mainnet (chainId 56).
const MAINNET_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log(`Network: ${network.name} (chainId ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);

  // 1) Resolve the Agent ID registry address.
  //    - explicit override via REGISTRY_ADDRESS
  //    - mainnet (56): the real registry
  //    - anything else (testnet/local): deploy a MockAgentIdRegistry we control
  let registryAddress = process.env.REGISTRY_ADDRESS;
  if (!registryAddress) {
    if (chainId === 56) {
      registryAddress = MAINNET_REGISTRY;
      console.log(`Using REAL Agent ID registry: ${registryAddress}`);
    } else {
      const Mock = await ethers.getContractFactory("MockAgentIdRegistry");
      const mock = await Mock.deploy();
      await mock.waitForDeployment();
      registryAddress = await mock.getAddress();
      console.log(`Deployed MockAgentIdRegistry (TEST ONLY): ${registryAddress}`);
    }
  } else {
    console.log(`Using REGISTRY_ADDRESS override: ${registryAddress}`);
  }
  // Normalize to a checksummed address so any-case input never trips ethers' validation.
  registryAddress = ethers.getAddress(registryAddress.toLowerCase());

  // 2) Operator = the FairSeat backend wallet allowed to commit off-chain-tap entrants.
  //    Defaults to the deployer for testnet; set OPERATOR_ADDRESS for mainnet.
  const operator = ethers.getAddress((process.env.OPERATOR_ADDRESS || deployer.address).toLowerCase());
  console.log(`Operator (entrant committer): ${operator}`);

  // 3) Deploy FairSeatVerifier.
  const Verifier = await ethers.getContractFactory("FairSeatVerifier");
  const verifier = await Verifier.deploy(registryAddress);
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`FairSeatVerifier: ${verifierAddress}`);

  // 4) Deploy GiveawayVault.
  const Vault = await ethers.getContractFactory("GiveawayVault");
  const vault = await Vault.deploy(registryAddress, operator);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`GiveawayVault: ${vaultAddress}`);

  // 4b) Deploy Poll (one Agent ID, one vote).
  const Poll = await ethers.getContractFactory("Poll");
  const poll = await Poll.deploy(registryAddress, operator);
  await poll.waitForDeployment();
  const pollAddress = await poll.getAddress();
  console.log(`Poll: ${pollAddress}`);

  // 4c) Deploy BatchDistributor (pay a verified list in one tx).
  const Dist = await ethers.getContractFactory("BatchDistributor");
  const dist = await Dist.deploy(registryAddress);
  await dist.waitForDeployment();
  const distributorAddress = await dist.getAddress();
  console.log(`BatchDistributor: ${distributorAddress}`);

  // 5) Persist addresses for the backend / verification scripts.
  const fs = await import("fs");
  const path = await import("path");
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const out = {
    network: network.name,
    chainId,
    registry: registryAddress,
    registryIsMock: chainId !== 56 && !process.env.REGISTRY_ADDRESS,
    operator,
    verifier: verifierAddress,
    vault: vaultAddress,
    poll: pollAddress,
    distributor: distributorAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\nSaved deployment to deployments/${network.name}.json`);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
