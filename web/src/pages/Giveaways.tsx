import { useEffect, useState } from "react";
import { api, type GiveawayView } from "../api";
import { fmt, countdown, RULE_LABEL } from "../lib";
import { useConfig } from "../App";

export function Giveaways() {
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
    <div style={{ paddingTop: "var(--s-2)" }}>
      <div className="row" style={{ alignItems: "flex-end", marginBottom: "var(--s-5)" }}>
        <div>
          <h2 className="page-title">Giveaways</h2>
          <p className="sub" style={{ margin: 0 }}>Open to anyone holding an Agent ID. Enter with a tap.</p>
        </div>
        <a href="#/create" className="btn btn-primary">Create a giveaway</a>
      </div>

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
    </div>
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
