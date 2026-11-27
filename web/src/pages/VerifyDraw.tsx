import { useState } from "react";
import { api } from "../api";
import { recomputeWinners, shortAddr, RULE_LABEL } from "../lib";
import { useConfig } from "../App";

export function VerifyDraw() {
  const config = useConfig();
  const [id, setId] = useState("");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setErr("");
    setData(null);
    try {
      const d = await api.draw(Number(id));
      setData(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const recomputed =
    data && data.seed && data.entrants
      ? recomputeWinners(data.entrants, data.rule, data.winnerCount, data.seed)
      : null;
  const matches =
    recomputed && data.winners
      ? JSON.stringify(recomputed.map((x: string) => x.toLowerCase())) ===
        JSON.stringify(data.winners.map((x: string) => x.toLowerCase()))
      : null;

  return (
    <div style={{ padding: "28px 0", maxWidth: 680, margin: "0 auto" }}>
      <h2 className="page-title">Check a draw</h2>
      <p className="sub">
        Anyone can recompute a random giveaway's winners from its public entrant list and block-hash seed — proof the
        result wasn't rigged. Nothing here is trusted; the math runs in your browser.
      </p>

      <div className="card stack">
        <div className="field" style={{ margin: 0 }}>
          <label>Giveaway ID</label>
          <div style={{ display: "flex", gap: 10 }}>
            <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. 5" />
            <button className="btn btn-primary" onClick={load} disabled={busy || !id}>
              {busy ? <span className="spinner" /> : "Check"}
            </button>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
      </div>

      {data && (
        <div className="card stack" style={{ marginTop: 16 }}>
          <div className="row">
            <span className="tag">{RULE_LABEL[data.rule]}</span>
            <span className={`badge ${data.status === "resolved" ? "badge-resolved" : "badge-open"}`}>{data.status}</span>
          </div>

          {data.status !== "resolved" ? (
            <div className="muted">This giveaway hasn't been drawn yet. Come back after it resolves.</div>
          ) : (
            <>
              <div>
                <div className="small muted">Block-hash seed (unknown until the draw block existed)</div>
                <div className="code mono" style={{ marginTop: 6 }}>
                  <span>{data.seed}</span>
                </div>
              </div>

              <div>
                <div className="small muted">Entrants ({data.entrants.length}) — committed before the seed existed</div>
                <div className="callout" style={{ marginTop: 6, maxHeight: 160, overflow: "auto" }}>
                  {data.entrants.map((a: string, i: number) => (
                    <div key={a} className="mono small">
                      {i + 1}. {shortAddr(a)}
                    </div>
                  ))}
                </div>
              </div>

              <div className="divider" />

              <div className="row">
                <strong>Recomputed winners</strong>
                {matches === true && <span className="ok">✓ matches on-chain result</span>}
                {matches === false && <span className="err">✗ mismatch</span>}
              </div>
              <div className="callout">
                {recomputed!.map((a: string) => (
                  <div key={a} className="mono win">
                    🏆 {a}
                  </div>
                ))}
              </div>
              {config && data.resolveTx && (
                <a className="link small" href={`${config.explorer}/tx/${data.resolveTx}`} target="_blank" rel="noreferrer">
                  View the on-chain payout →
                </a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
