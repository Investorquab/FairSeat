import { useEffect, useState } from "react";
import { api, type PollView } from "../api";
import { countdown } from "../lib";
import { Verify, getWebIdentity } from "../components/Verify";
import { TallyBars } from "./Votes";

export function PollDetail({ id }: { id: number }) {
  const [poll, setPoll] = useState<PollView | null>(null);
  const [verified, setVerified] = useState<string | null>(getWebIdentity()?.wallet ?? null);
  const [voted, setVoted] = useState<boolean>(() => {
    try { return localStorage.getItem(`fs_voted_${id}`) === "1"; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, tick] = useState(0);

  useEffect(() => {
    const load = () => api.poll(id).then(setPoll).catch(() => {});
    load();
    const i = setInterval(load, 5000);
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => { clearInterval(i); clearInterval(t); };
  }, [id]);

  async function vote(option: number) {
    const ident = getWebIdentity();
    if (!ident) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.votePoll(id, ident.token, option);
      if (r.ok) {
        setVoted(true);
        try { localStorage.setItem(`fs_voted_${id}`, "1"); } catch { /* ignore */ }
        api.poll(id).then(setPoll).catch(() => {});
      } else setErr(reason(r.reason));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!poll) return <div style={{ padding: 40 }} className="muted">Loading poll #{id}…</div>;
  const open = poll.status === "open" && Date.now() < poll.entriesCloseAt;

  return (
    <div style={{ padding: "28px 0", maxWidth: 680, margin: "0 auto" }}>
      <a href="#/votes" className="link small">← all votes</a>
      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="row">
          <span className={`badge ${open ? "badge-open" : "badge-resolved"}`}>{open ? "● open" : "closed"}</span>
          <span className="tag">{poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}</span>
        </div>
        <h2 className="page-title" style={{ fontSize: 28 }}>{poll.question}</h2>
        <div className="small muted">
          {open ? `Closes in ${countdown(poll.entriesCloseAt)}` : "Voting has closed"} · one Agent ID, one vote
        </div>

        <div className="divider" />
        <TallyBars poll={poll} />
      </div>

      {open && !voted && (
        <div className="stack" style={{ marginTop: 16 }}>
          {!verified ? (
            <Verify onVerified={(w) => setVerified(w)} />
          ) : (
            <div className="card stack">
              <strong>Cast your vote</strong>
              <div className="stack">
                {poll.options.map((o, i) => (
                  <button key={i} className="btn btn-ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => vote(i)} disabled={busy}>
                    {o}
                  </button>
                ))}
              </div>
              {err && <div className="err">{err}</div>}
            </div>
          )}
        </div>
      )}
      {voted && (
        <div className="card center" style={{ marginTop: 16 }}>
          <div className="prize" style={{ fontSize: 20 }}>✅ Vote counted</div>
          <div className="muted small">Thanks - the tally above updates live.</div>
        </div>
      )}
    </div>
  );
}

function reason(r: string): string {
  return ({ not_verified: "Verify your Agent ID first.", not_open: "This poll isn't open.", closed: "Voting has closed.", already: "You've already voted.", bad_option: "Invalid option." } as Record<string, string>)[r] ?? "Could not vote.";
}
