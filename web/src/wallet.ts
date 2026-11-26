import { ethers } from "ethers";

export async function connectWallet(): Promise<{ signer: ethers.Signer; address: string; chainId: number }> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No browser wallet found. Install MetaMask (or any EVM wallet) to fund a giveaway.");
  const provider = new ethers.BrowserProvider(eth);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const net = await provider.getNetwork();
  return { signer, address: await signer.getAddress(), chainId: Number(net.chainId) };
}

export async function sendTx(signer: ethers.Signer, tx: { to: string; value: string; data: string }) {
  return signer.sendTransaction({ to: tx.to, value: BigInt(tx.value), data: tx.data || "0x" });
}
