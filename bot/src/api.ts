import http from "node:http";
import { ethers } from "ethers";
import type { Service } from "./service.js";
import { config } from "./config.js";

type Res = http.ServerResponse;

function json(res: Res, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(s);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// Simple per-IP rate limit on write endpoints (F-6): a sliding window in memory. In production,
// also rate-limit at the reverse proxy.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 40;
const rlHits = new Map<string, number[]>();
function rateLimited(req: http.IncomingMessage): boolean {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0];
  const ip = (fwd || req.socket.remoteAddress || "unknown").trim();
  const now = Date.now();
  const arr = (rlHits.get(ip) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  rlHits.set(ip, arr);
  if (rlHits.size > 5000) for (const [k, v] of rlHits) if (v.every((t) => now - t > RL_WINDOW_MS)) rlHits.delete(k);
  return arr.length > RL_MAX;
}

export function startApi(service: Service, port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname;
      if (req.method === "OPTIONS") return json(res, 204, {});
      if (req.method === "POST" && rateLimited(req)) return json(res, 429, { error: "rate limited" });

      if (req.method === "GET" && path === "/api/config") {
        return json(res, 200, {
          chainId: config.chainId,
          verifier: config.verifierAddress,
          vault: config.vaultAddress,
          poll: config.pollAddress,
          distributor: process.env.DISTRIBUTOR_ADDRESS ?? "",
          registry: config.registryAddress,
          explorer: config.explorer,
          nativeSymbol: config.nativeSymbol,
        });
      }
      if (req.method === "GET" && path === "/api/giveaways") {
        return json(res, 200, { giveaways: service.publicGiveaways() });
      }
      let m: RegExpMatchArray | null;
      if ((m = path.match(/^\/api\/giveaways\/(\d+)$/)) && req.method === "GET") {
        const v = service.giveawayView(Number(m[1]), url.searchParams.get("key") ?? undefined);
        return v ? json(res, 200, v) : json(res, 404, { error: "not found" });
      }
      if ((m = path.match(/^\/api\/draw\/(\d+)$/)) && req.method === "GET") {
        const v = service.drawView(Number(m[1]));
        return v ? json(res, 200, v) : json(res, 404, { error: "not found" });
      }
      if (req.method === "POST" && path === "/api/verify/start") {
        const v = service.startWebVerification();
        return json(res, 200, {
          token: v.token,
          amount: ethers.formatEther(v.amountWei),
          amountWei: v.amountWei.toString(),
          verifier: v.verifier,
          nativeSymbol: config.nativeSymbol,
        });
      }
      if (req.method === "GET" && path === "/api/verify/status") {
        return json(res, 200, service.webStatus(url.searchParams.get("token") ?? ""));
      }
      if ((m = path.match(/^\/api\/giveaways\/(\d+)\/enter$/)) && req.method === "POST") {
        const b = await readBody(req);
        const r = await service.enterGiveaway(Number(m[1]), `web:${b.token}`, {
          membershipOk: false, // web users can enter public / private(key) giveaways, not Telegram-group ones
          providedKey: b.key,
        });
        return json(res, 200, r);
      }
      if (req.method === "POST" && path === "/api/prepare") {
        const b = await readBody(req);
        if (!b.hostWallet) return json(res, 400, { error: "hostWallet (connected wallet address) is required" });
        const r = await service.prepareGiveaway({
          creatorIdentity: `web:${String(b.hostWallet).toLowerCase()}`,
          hostWallet: b.hostWallet,
          chatId: 0,
          token: b.tokenAddress || ethers.ZeroAddress,
          prizeWei: ethers.parseEther(String(b.amount)),
          winnerCount: Number(b.winners || 1),
          rule: Number(b.rule),
          entryMode: Number(b.entryMode || 0),
          scope: b.scope,
          accessKey: b.key || null,
          durationSeconds: Number(b.durationSeconds),
        });
        return json(res, 200, r);
      }

      // ---- polls ----
      if (req.method === "GET" && path === "/api/polls") {
        return json(res, 200, { polls: service.publicPolls() });
      }
      if ((m = path.match(/^\/api\/polls\/(\d+)$/)) && req.method === "GET") {
        const v = service.pollView(Number(m[1]));
        return v ? json(res, 200, v) : json(res, 404, { error: "not found" });
      }
      if ((m = path.match(/^\/api\/polls\/(\d+)\/vote$/)) && req.method === "POST") {
        const b = await readBody(req);
        const r = await service.votePoll(Number(m[1]), `web:${b.token}`, Number(b.option));
        return json(res, 200, r);
      }
      if (req.method === "POST" && path === "/api/polls/prepare") {
        const b = await readBody(req);
        if (!b.hostWallet) return json(res, 400, { error: "hostWallet (connected wallet address) is required" });
        const r = await service.preparePoll({
          creatorIdentity: `web:${String(b.hostWallet).toLowerCase()}`,
          hostWallet: b.hostWallet,
          chatId: 0,
          question: String(b.question ?? ""),
          options: Array.isArray(b.options) ? b.options.map(String) : [],
          mode: Number(b.mode ?? 1),
          durationSeconds: Number(b.durationSeconds),
        });
        return json(res, 200, r);
      }

      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
  });
  server.listen(port, () => console.log(`FairSeat API listening on :${port}`));
  return server;
}
