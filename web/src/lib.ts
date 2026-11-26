import { ethers } from "ethers";

export function fmt(wei: string | null | undefined): string {
  if (!wei) return "0";
  const s = ethers.formatEther(BigInt(wei));
  // trim trailing zeros
  return s.replace(/\.?0+$/, "") || "0";
}

export function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function countdown(closeAtMs: number): string {
  const ms = closeAtMs - Date.now();
  if (ms <= 0) return "closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// Recompute the winners exactly like GiveawayVault._selectWinners, so anyone can verify a draw.
// rule: 0 FirstN, 1 Random, 2 SplitEqually
export function recomputeWinners(entrants: string[], rule: number, winnerCount: number, seed: string): string[] {
  const len = entrants.length;
  if (len === 0) return [];
  if (rule === 2) return [...entrants]; // SplitEqually: everyone
  const count = Math.min(winnerCount, len);
  if (rule === 0) return entrants.slice(0, count); // FirstN

  // Random — partial Fisher-Yates seeded by keccak256(abi.encode(seed, i))
  const pool = [...entrants];
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const seedBig = BigInt(seed);
  const winners: string[] = [];
  for (let i = 0; i < count; i++) {
    const h = ethers.keccak256(coder.encode(["uint256", "uint256"], [seedBig, i]));
    const j = i + Number(BigInt(h) % BigInt(len - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    winners.push(pool[i]);
  }
  return winners;
}

export const RULE_LABEL: Record<number, string> = {
  0: "First N entrants",
  1: "Random draw",
  2: "Split equally",
};
