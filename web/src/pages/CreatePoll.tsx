import { useState } from "react";
import { api } from "../api";
import { connectWallet, sendTx } from "../wallet";
import { useConfig } from "../App";
import { shortAddr } from "../lib";

const UNITS = [
  { v: 60, label: "minutes" },
  { v: 3600, label: "hours" },
  { v: 86400, label: "days" },
];

export function CreatePoll() {
  const config = useConfig();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [durVal, setDurVal] = useState("1");
  const [durUnit, setDurUnit] = useState(3600);
  const [mode, setMode] = useState(1); // 1 = tap, 0 = on-chain
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const setOpt = (i: number, v: string) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));

  async function connect() {
    setErr("");
    try {
      const { address, chainId } = await connectWallet();
      if (config && chainId !== config.chainId) { setErr(`Switch your wallet to chain ${config.chainId}.`); return; }
      setAddress(address);
    } catch (e) { setErr((e as Error).message); }
  }

  async function launch() {
    if (!address) return;
    setErr("");
    setBusy(true);
    try {
      const prep = await api.preparePoll({
        hostWallet: address,
        question,
        options: options.map((o) => o.trim()).filter(Boolean),
        mode,
        durationSeconds: Number(durVal) * durUnit,
      });
      if (prep.error) { setErr(prep.error); setBusy(false); return; }
      const { signer } = await connectWallet();
      const sent = await sendTx(signer, prep.tx);
      await sent.wait();
      setDone(true);
    } catch (e) {
      setErr((e as Error).message?.slice(0, 160) ?? "Transaction failed");
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div style={{ padding: "28px 0", maxWidth: 560, margin: "0 auto" }}>
        <div className="card stack center">
          <div className="prize" style={{ fontSize: 24 }}>🗳️ Poll is live!</div>
          <p className="muted">It's open on-chain. It'll appear on the Votes page in a few seconds, ready to share.</p>
          <a className="btn btn-primary" href="#/votes">Go to votes</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 0", maxWidth: 600, margin: "0 auto" }}>
      <h2 className="page-title">New poll</h2>
      <p className="sub">One Agent ID, one vote. Open and on-chain — anyone can audit the tally.</p>
      <div className="card stack">
        <div className="field" style={{ margin: 0 }}>
          <label>Question</label>
          <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Which feature should we build next?" />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Options</label>
          <div className="stack">
            {options.map((o, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <input className="input" value={o} onChange={(e) => setOpt(i, e.target.value)} placeholder={`Option ${i + 1}`} />
                {options.length > 2 && (
                  <button className="btn btn-ghost" onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}>✕</button>
                )}
              </div>
            ))}
            {options.length < 12 && (
              <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setOptions((o) => [...o, ""])}>+ Add option</button>
            )}
          </div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Voting window</label>
          <div style={{ display: "flex", gap: 10 }}>
            <input className="input" style={{ flex: 1 }} value={durVal} onChange={(e) => setDurVal(e.target.value)} inputMode="numeric" />
            <select className="select" style={{ flex: 1 }} value={durUnit} onChange={(e) => setDurUnit(Number(e.target.value))}>
              {UNITS.map((u) => <option key={u.v} value={u.v}>{u.label}</option>)}
            </select>
          </div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Voting method</label>
          <div className="seg">
            <button className={mode === 1 ? "on" : ""} onClick={() => setMode(1)}>Tap to vote<div className="small muted" style={{ fontWeight: 500 }}>frictionless</div></button>
            <button className={mode === 0 ? "on" : ""} onClick={() => setMode(0)}>On-chain vote<div className="small muted" style={{ fontWeight: 500 }}>fully trustless</div></button>
          </div>
        </div>
        <div className="divider" />
        {!address ? (
          <button className="btn btn-ghost" onClick={connect}>Connect wallet to create</button>
        ) : (
          <div className="row">
            <span className="small muted">Creating from <span className="mono">{shortAddr(address)}</span></span>
            <button className="btn btn-primary" onClick={launch} disabled={busy}>{busy ? <span className="spinner" /> : "Open poll"}</button>
          </div>
        )}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
