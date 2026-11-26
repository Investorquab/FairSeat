import { useEffect, useState } from "react";
import { api, type GiveawayView } from "../api";
import { fmt, countdown, shortAddr, RULE_LABEL } from "../lib";
import { useConfig } from "../App";
import { Verify, getWebIdentity } from "../components/Verify";

export function GiveawayDetail({ id }: { id: number }) {
  const config = useConfig();
  const [g, setG] = useState<GiveawayView | null>(null);
  const [locked, setLocked] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [verified, setVerified] = useState<string | null>(getWebIdentity()?.wallet ?? null);
  const [entered, setEntered] = useState(false);
  const [entering, setEntering] = useState(false);
  const [err, setErr] = useState("");
  const [, tick] = useState(0);

  async function load(key?: string) {
    try {
      const v = await api.giveaway(id, key);
      if ((v as any).locked) {
        setLocked(true);
        setG(null);
      } else {
        setLocked(false);
        setG(v);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
    const i = setInterval(() => load(keyInput || undefined), 6000);
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => {
      clearInterval(i);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function enter() {
    const ident = getWebIdentity();
    if (!ident) return;
    setEntering(true);
    setErr("");
    try {
      const r = await api.enter(id, ident.token, keyInput || undefined);
      if (r.ok) setEntered(true);
      else setErr(reason(r.reason));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setEntering(false);
    }
  }

  const sym = config?.nativeSymbol ?? "BNB";

  if (locked) {
    return (
      <div style={{ padding: "28px 0", maxWidth: 560, margin: "0 auto" }}>
        <h2 className="page-title">Private giveaway</h2>
        <p className="sub">This giveaway is community-only. Enter the access key your host shared.</p>
        <div className="card stack">
          <input className="input" placeholder="Access key" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
          <button className="btn btn-primary" onClick={() => load(keyInput)}>Unlock</button>
          {err && <div className="err">{err}</div>}
        </div>
      </div>
    );
  }
  if (!g) return <div style={{ padding: 40 }} className="muted">Loading giveaway #{id}…</div>;

  const open = g.status === "open" && Date.now() < g.entriesCloseAt;

  return (
    <div style={{ padding: "28px 0", maxWidth: 680, margin: "0 auto" }}>
      <a href="#/" className="link small">← all giveaways</a>
      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="row">
          <span className={`badge ${g.status === "resolved" ? "badge-resolved" : "badge-open"}`}>
            {g.status === "resolved" ? "resolved" : open ? "live" : "drawing"}
          </span>
          <span className="tag">{RULE_LABEL[g.rule]}</span>
          <span className="badge badge-scope">{g.scope}</span>
        </div>
        <div className="prize" style={{ fontSize: 34 }}>
          {fmt(g.prizeWei)} <small>{sym}</small>
        </div>
        <div className="row small muted">
          <span>{g.winnerCount} winner{g.winnerCount > 1 ? "s" : ""} · {g.entryCount} entered</span>
          <span style={{ fontWeight: 700, color: "var(--text)" }}>
            {g.status === "open" ? `closes in ${countdown(g.entriesCloseAt)}` : g.status}
          </span>
        </div>
      </div>

      {g.status === "resolved" ? (
        <div className="card stack" style={{ marginTop: 16 }}>
          <strong>🏆 Winners</strong>
          <div className="callout">
            {(g.winners ?? []).length === 0 ? (
              <span className="muted">No entrants — prize returned to the host.</span>
            ) : (
              (g.winners ?? []).map((w) => (
                <div key={w} className="mono win">
                  🏆 {shortAddr(w)} — {fmt(g.perWinnerWei)} {sym}
                </div>
              ))
            )}
          </div>
          <a className="link" href={`#/verify?id=${g.id}`}>Verify this draw yourself →</a>
          {config && g.resolveTx && (
            <a className="link small" href={`${config.explorer}/tx/${g.resolveTx}`} target="_blank" rel="noreferrer">
              View on-chain payout →
            </a>
          )}
        </div>
      ) : g.scope === "members" ? (
        <div className="card center muted" style={{ marginTop: 16 }}>
          This is a Telegram group giveaway — enter it from the group chat.
        </div>
      ) : !open ? (
        <div className="card center muted" style={{ marginTop: 16 }}>Entries are closed — drawing shortly.</div>
      ) : entered ? (
        <div className="card center" style={{ marginTop: 16 }}>
          <div className="prize" style={{ fontSize: 22 }}>✅ You're in!</div>
          <div className="muted small">Good luck — winners are paid automatically to their Agent-ID wallet.</div>
        </div>
      ) : (
        <div className="stack" style={{ marginTop: 16 }}>
          {!verified ? (
            <Verify onVerified={(w) => setVerified(w)} />
          ) : (
            <div className="card stack center">
              <div className="small muted">Verified as {shortAddr(verified)}</div>
              <button className="btn btn-primary btn-lg" onClick={enter} disabled={entering}>
                {entering ? <span className="spinner" /> : "🎟️ Enter giveaway"}
              </button>
              {err && <div className="err">{err}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function reason(r: string): string {
  return (
    {
      not_verified: "Verify your Agent ID first.",
      not_open: "This giveaway isn't open.",
      closed: "Entries are closed.",
      already: "You're already entered.",
      wrong_key: "Wrong access key.",
      not_member: "This giveaway is for Telegram group members.",
    }[r] ?? "Could not enter."
  );
}
