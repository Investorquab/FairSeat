import { useEffect, useState } from "react";
import { api, type GiveawayView } from "../api";
import { fmt, countdown, RULE_LABEL } from "../lib";
import { useConfig } from "../App";

export function Home() {
  const config = useConfig();
  const [gs, setGs] = useState<GiveawayView[] | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const load = () => api.giveaways().then((r) => setGs(r.giveaways)).catch(() => setGs([]));
    load();
    const i = setInterval(load, 8000);
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => {
      clearInterval(i);
      clearInterval(t);
    };
  }, []);
  const sym = config?.nativeSymbol ?? "BNB";

  return (
    <>
      <section className="hero">
        <div className="pill">
          <span className="dot" /> Powered by Binance Agent ID on BNB Chain
        </div>
        <h1>
          One Agent ID,
          <br />
          <span className="grad">one seat.</span>
        </h1>
        <p>
          Fair community giveaways where each Binance Agent ID counts once. Rewards are locked on-chain, winners are
          drawn provably-fair, and every result is checkable by anyone.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="#/create" className="btn btn-primary btn-lg">Create a giveaway</a>
          <a href="#/verify" className="btn btn-ghost btn-lg">Verify a draw</a>
        </div>
      </section>

      <div className="row" style={{ marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>Live &amp; recent giveaways</h2>
      </div>

      {gs === null ? (
        <div className="muted">Loading…</div>
      ) : gs.length === 0 ? (
        <div className="card center muted">
          No public giveaways yet.{" "}
          <a className="link" href="#/create">Create the first one →</a>
        </div>
      ) : (
        <div className="grid">
          {gs.map((g) => (
            <GCard key={g.id} g={g} sym={sym} />
          ))}
        </div>
      )}
      <div style={{ height: 40 }} />
    </>
  );
}

function GCard({ g, sym }: { g: GiveawayView; sym: string }) {
  const open = g.status === "open" && Date.now() < g.entriesCloseAt;
  return (
    <a href={`#/g/${g.id}`} className="card card-hover stack">
      <div className="row">
        <span className={`badge ${g.status === "resolved" ? "badge-resolved" : "badge-open"}`}>
          {g.status === "resolved" ? "resolved" : open ? "live" : "drawing"}
        </span>
        <span className="tag">{RULE_LABEL[g.rule]}</span>
      </div>
      <div className="prize">
        {fmt(g.prizeWei)} <small>{sym}</small>
      </div>
      <div className="row small muted">
        <span>
          {g.winnerCount} winner{g.winnerCount > 1 ? "s" : ""}
        </span>
        <span>{g.entryCount} entered</span>
      </div>
      <div className="divider" style={{ margin: "6px 0" }} />
      <div className="row small">
        <span className="muted">{g.status === "open" ? "closes in" : "status"}</span>
        <span style={{ fontWeight: 700 }}>{g.status === "open" ? countdown(g.entriesCloseAt) : g.status}</span>
      </div>
    </a>
  );
}
