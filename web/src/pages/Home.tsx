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
        <div className="hero-ground" />
        <div className="wrap">
          <div className="pill" data-enter>
            <span className="dot" /> Powered by Binance Agent ID on BNB Chain
          </div>
          <h1 data-enter="2">
            One Agent ID,
            <br />
            <span className="grad">one seat.</span>
          </h1>
          <p className="lead" data-enter="3">
            Community giveaways where each Binance Agent ID counts once. Rewards are locked on-chain, winners are drawn
            provably-fair, and every result is checkable by anyone — no sign-ups, no multi-wallet farming.
          </p>
          <div className="btn-row" data-enter="4">
            <a href="#/create" className="btn btn-primary btn-lg">Create a giveaway</a>
            <a href="#/verify" className="btn btn-ghost btn-lg">Verify a draw</a>
          </div>

          <div className="feature-row">
            <div className="card feature" data-enter="2">
              <div className="ic">🔒</div>
              <h3>Locked on-chain</h3>
              <p>Hosts fund a vault before launch. No one — not even FairSeat — can withdraw it early. Winners are paid automatically.</p>
            </div>
            <div className="card feature" data-enter="3">
              <div className="ic">🎲</div>
              <h3>Provably fair</h3>
              <p>Random winners come from a future block hash with entrants fixed beforehand. Anyone can recompute the result.</p>
            </div>
            <div className="card feature" data-enter="4">
              <div className="ic">🪑</div>
              <h3>One seat each</h3>
              <p>A Binance Agent ID is one-per-account and non-transferable. Verify once with a tap, then join with one more.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: "var(--s-9)" }}>
        <div className="preview-head">
          <span className="dot" /> Live on {config ? (config.chainId === 56 ? "BNB Chain" : "BNB testnet") : "BNB Chain"}
        </div>
        <h2 className="page-title">Live &amp; recent giveaways</h2>
        <p className="sub">Open to anyone holding an Agent ID. Verify once, then enter with a tap.</p>

        {gs === null ? (
          <div className="muted">Loading…</div>
        ) : gs.length === 0 ? (
          <div className="card center muted">
            No public giveaways yet. <a className="link" href="#/create">Create the first one →</a>
          </div>
        ) : (
          <div className="grid">
            {gs.map((g) => (
              <GCard key={g.id} g={g} sym={sym} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function GCard({ g, sym }: { g: GiveawayView; sym: string }) {
  const open = g.status === "open" && Date.now() < g.entriesCloseAt;
  return (
    <a href={`#/g/${g.id}`} className="card card-hover stack">
      <div className="row">
        <span className={`badge ${g.status === "resolved" ? "badge-resolved" : "badge-open"}`}>
          {g.status === "resolved" ? "resolved" : open ? "● live" : "drawing"}
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
