import { useEffect, useState } from "react";
import { api, type PollView } from "../api";
import { countdown } from "../lib";

export function Votes() {
  const [polls, setPolls] = useState<PollView[] | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const load = () => api.polls().then((r) => setPolls(r.polls)).catch(() => setPolls([]));
    load();
    const i = setInterval(load, 7000);
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => { clearInterval(i); clearInterval(t); };
  }, []);

  return (
    <section className="wrap" style={{ padding: "40px 0 var(--s-9)" }}>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="preview-head"><span className="dot" /> One Agent ID, one vote</div>
          <h2 className="page-title">Votes</h2>
          <p className="sub">Open, on-chain polls where each Agent ID counts once - no brigading, no fake wallets.</p>
        </div>
        <a href="#/create-poll" className="btn btn-primary">New poll</a>
      </div>

      {polls === null ? (
        <div className="muted">Loading…</div>
      ) : polls.length === 0 ? (
        <div className="card center muted">No polls yet. <a className="link" href="#/create-poll">Start one →</a></div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {polls.map((p) => (
            <a key={p.id} href={`#/p/${p.id}`} className="card card-hover stack">
              <div className="row">
                <span className={`badge ${p.status === "closed" ? "badge-resolved" : "badge-open"}`}>
                  {p.status === "closed" ? "closed" : "● open"}
                </span>
                <span className="tag">{p.totalVotes} vote{p.totalVotes === 1 ? "" : "s"}</span>
              </div>
              <h3 style={{ fontSize: 19 }}>{p.question}</h3>
              <TallyBars poll={p} compact />
              <div className="row small">
                <span className="muted">{p.status === "open" ? "closes in" : "status"}</span>
                <span style={{ fontWeight: 700 }}>{p.status === "open" ? countdown(p.entriesCloseAt) : "closed"}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

export function TallyBars({ poll, compact }: { poll: PollView; compact?: boolean }) {
  const total = Math.max(1, poll.totalVotes);
  const rows = poll.options.map((o, i) => ({ o, c: poll.tally[i] ?? 0 }));
  const shown = compact ? rows.slice(0, 3) : rows;
  return (
    <div className="stack" style={{ marginTop: compact ? 4 : 8 }}>
      {shown.map(({ o, c }, i) => {
        const pct = Math.round((c / total) * 100);
        return (
          <div key={i}>
            <div className="row small" style={{ marginBottom: 5 }}>
              <span style={{ color: "var(--ink)" }}>{o}</span>
              <span className="muted">{c} · {pct}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "var(--bg-2)", overflow: "hidden", border: "1px solid var(--line)" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, var(--accent), #1fae7d)", transition: "width .4s ease" }} />
            </div>
          </div>
        );
      })}
      {compact && rows.length > 3 && <div className="small faint">+{rows.length - 3} more</div>}
    </div>
  );
}
