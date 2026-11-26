import { useState } from "react";
import { api } from "../api";
import { connectWallet, sendTx } from "../wallet";
import { useConfig } from "../App";
import { shortAddr } from "../lib";

const RULES = [
  { v: 1, label: "Random draw", hint: "provably fair" },
  { v: 0, label: "First N", hint: "by entry order" },
  { v: 2, label: "Split equally", hint: "everyone shares" },
];
const UNITS = [
  { v: 60, label: "minutes" },
  { v: 3600, label: "hours" },
  { v: 86400, label: "days" },
];

export function Create() {
  const config = useConfig();
  const sym = config?.nativeSymbol ?? "BNB";

  const [amount, setAmount] = useState("0.01");
  const [winners, setWinners] = useState("1");
  const [rule, setRule] = useState(1);
  const [scope, setScope] = useState<"public" | "private">("public");
  const [accessKey, setAccessKey] = useState("");
  const [durVal, setDurVal] = useState("60");
  const [durUnit, setDurUnit] = useState(60);
  const [entryMode, setEntryMode] = useState(0);

  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ txHash: string } | null>(null);

  async function connect() {
    setErr("");
    try {
      const { address, chainId } = await connectWallet();
      if (config && chainId !== config.chainId) {
        setErr(`Wrong network — please switch your wallet to chain ${config.chainId}.`);
        return;
      }
      setAddress(address);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function launch() {
    setErr("");
    if (!address) return;
    setBusy(true);
    try {
      const prep = await api.prepare({
        hostWallet: address,
        amount,
        winners: Number(winners),
        rule,
        scope,
        key: scope === "private" ? accessKey : undefined,
        entryMode: scope === "public" ? entryMode : 0,
        durationSeconds: Number(durVal) * durUnit,
      });
      if (prep.error) {
        setErr(prep.error);
        setBusy(false);
        return;
      }
      const { signer } = await connectWallet();
      const sent = await sendTx(signer, prep.tx);
      await sent.wait();
      setDone({ txHash: sent.hash });
    } catch (e) {
      setErr((e as Error).message?.slice(0, 160) ?? "Transaction failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div style={{ padding: "28px 0", maxWidth: 560, margin: "0 auto" }}>
        <div className="card stack center">
          <div className="prize" style={{ fontSize: 26 }}>🎉 Giveaway funded &amp; locked!</div>
          <p className="muted">
            Your reward is locked on-chain — no one, including FairSeat, can withdraw it early. It will appear on the
            home page within a few seconds, ready to share.
          </p>
          {config && (
            <a className="link small" href={`${config.explorer}/tx/${done.txHash}`} target="_blank" rel="noreferrer">
              View funding transaction →
            </a>
          )}
          <a className="btn btn-primary" href="#/">Go to giveaways</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 0", maxWidth: 620, margin: "0 auto" }}>
      <h2 className="page-title">Create a giveaway</h2>
      <p className="sub">
        Lock a reward on-chain and let your community enter — one Agent ID, one seat. You fund it from your own wallet;
        winners are paid automatically.
      </p>

      <div className="card stack">
        <div className="field" style={{ margin: 0 }}>
          <label>Reward amount ({sym})</label>
          <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label>Winner selection</label>
          <div className="seg">
            {RULES.map((r) => (
              <button key={r.v} className={rule === r.v ? "on" : ""} onClick={() => setRule(r.v)}>
                {r.label}
                <div className="small muted" style={{ fontWeight: 500 }}>{r.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {rule !== 2 && (
          <div className="field" style={{ margin: 0 }}>
            <label>Number of winners</label>
            <input className="input" value={winners} onChange={(e) => setWinners(e.target.value)} inputMode="numeric" />
          </div>
        )}

        <div className="field" style={{ margin: 0 }}>
          <label>Entry window</label>
          <div style={{ display: "flex", gap: 10 }}>
            <input className="input" style={{ flex: 1 }} value={durVal} onChange={(e) => setDurVal(e.target.value)} inputMode="numeric" />
            <select className="select" style={{ flex: 1 }} value={durUnit} onChange={(e) => setDurUnit(Number(e.target.value))}>
              {UNITS.map((u) => (
                <option key={u.v} value={u.v}>{u.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label>Who can enter</label>
          <div className="seg">
            <button className={scope === "public" ? "on" : ""} onClick={() => setScope("public")}>
              Public
              <div className="small muted" style={{ fontWeight: 500 }}>anyone, listed here</div>
            </button>
            <button className={scope === "private" ? "on" : ""} onClick={() => setScope("private")}>
              Private
              <div className="small muted" style={{ fontWeight: 500 }}>needs an access key</div>
            </button>
          </div>
        </div>

        {scope === "private" && (
          <div className="field" style={{ margin: 0 }}>
            <label>Access key (share with your community)</label>
            <input className="input" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} placeholder="e.g. community-only-2026" />
          </div>
        )}

        {scope === "public" && (
          <div className="field" style={{ margin: 0 }}>
            <label>Entry method</label>
            <div className="seg">
              <button className={entryMode === 0 ? "on" : ""} onClick={() => setEntryMode(0)}>
                Tap to enter
                <div className="small muted" style={{ fontWeight: 500 }}>frictionless</div>
              </button>
              <button className={entryMode === 1 ? "on" : ""} onClick={() => setEntryMode(1)}>
                On-chain entry
                <div className="small muted" style={{ fontWeight: 500 }}>fully trustless</div>
              </button>
            </div>
          </div>
        )}

        <div className="divider" />

        {!address ? (
          <button className="btn btn-ghost" onClick={connect}>Connect wallet to fund</button>
        ) : (
          <div className="row">
            <span className="small muted">Funding from <span className="mono">{shortAddr(address)}</span></span>
            <button className="btn btn-primary" onClick={launch} disabled={busy}>
              {busy ? <span className="spinner" /> : `Fund & launch`}
            </button>
          </div>
        )}
        {err && <div className="err">{err}</div>}
        <div className="small muted">
          Funds are locked in an open-source vault. You can only ever reclaim leftovers after the draw — never the whole
          prize once people enter. You confirm the transaction in your own wallet.
        </div>
      </div>
      <div style={{ height: 30 }} />
    </div>
  );
}
