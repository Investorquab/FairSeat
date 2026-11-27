const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

async function get(p: string) {
  const r = await fetch(BASE + p);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function post(p: string, body?: unknown) {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

export interface GiveawayView {
  id: number;
  token: string;
  prizeWei: string;
  winnerCount: number;
  rule: number;
  ruleLabel: string;
  scope: "members" | "public" | "private";
  entryMode: number;
  status: "open" | "resolved" | "cancelled";
  entriesCloseAt: number;
  drawBlock: number;
  entryCount: number;
  winners: string[] | null;
  perWinnerWei: string | null;
  seed: string | null;
  resolveTx: string | null;
  locked?: true;
}

export interface Config {
  chainId: number;
  verifier: string;
  vault: string;
  poll?: string;
  distributor?: string;
  registry: string;
  explorer: string;
  nativeSymbol: string;
}

export const api = {
  config: (): Promise<Config> => get("/api/config"),
  giveaways: (): Promise<{ giveaways: GiveawayView[] }> => get("/api/giveaways"),
  giveaway: (id: number, key?: string): Promise<GiveawayView> =>
    get(`/api/giveaways/${id}` + (key ? `?key=${encodeURIComponent(key)}` : "")),
  draw: (id: number): Promise<any> => get(`/api/draw/${id}`),
  verifyStart: (): Promise<{ token: string; amount: string; amountWei: string; verifier: string; nativeSymbol: string }> =>
    post("/api/verify/start"),
  verifyStatus: (token: string): Promise<{ verified: boolean; wallet: string | null; seatKey: string | null }> =>
    get(`/api/verify/status?token=${token}`),
  verifyRestore: (seatKey: string): Promise<{ token?: string; wallet?: string; seatKey?: string; error?: string }> =>
    post("/api/verify/restore", { seatKey }),
  enter: (id: number, token: string, key?: string): Promise<any> => post(`/api/giveaways/${id}/enter`, { token, key }),
  prepare: (b: Record<string, unknown>): Promise<any> => post("/api/prepare", b),
  polls: (): Promise<{ polls: PollView[] }> => get("/api/polls"),
  poll: (id: number): Promise<PollView> => get(`/api/polls/${id}`),
  votePoll: (id: number, token: string, option: number): Promise<any> => post(`/api/polls/${id}/vote`, { token, option }),
  preparePoll: (b: Record<string, unknown>): Promise<any> => post("/api/polls/prepare", b),
};

export interface PollView {
  id: number;
  question: string;
  options: string[];
  mode: number;
  status: "open" | "closed";
  closeBlock: number;
  entriesCloseAt: number;
  totalVotes: number;
  tally: number[];
}
