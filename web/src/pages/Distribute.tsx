import { useState } from "react";
import { ethers } from "ethers";
import { useConfig } from "../App";
import { connectWallet } from "../wallet";
import { shortAddr } from "../lib";

const ABI = [
  "function distribute(address token, address[] recipients, uint256[] amounts) payable",
  "function holders(address[] addrs) view returns (bool[])",
];

interface Row {
  address: string;
  amount: string;
  valid: boolean;
  holder?: boolean;
}

function parseCsv(text: string): Row[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [addr, amt] = line.split(/[,\s]+/);
      let valid = false;
      let address = addr ?? "";
      try {
        address = ethers.getAddress(addr);
        valid = !!amt && Number(amt) > 0;
      } catch {
        /* invalid address */
      }
      return { address, amount: amt ?? "", valid };
    });
}

export function Distribute() {
  const config = useConfig();
  const sym = config?.nativeSymbol ?? "BNB";
  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ tx: string } | null>(null);

  const valid = rows?.filter((r) => r.valid) ?? [];
  const total = valid.reduce((a, r) => a + Number(r.amount), 0);

  async function connect() {
    setErr("");
    try {
      const { address, chainId } = await connectWallet();
      if (config && chainId !== config.chainId) { setErr(`Switch your wallet to chain ${config.chainId}.`); return; }
      setAddress(address);
    } catch (e) { setErr((e as Error).message); }
  }

  async function check() {
    if (!address) { setErr("Connect your wallet first to check."); return; }
    setErr("");
    try {
      const { signer } = await connectWallet();
      const c = new ethers.Contract(config!.distributor!, ABI, signer);
      const res: boolean[] = await c.holders(valid.map((r) => r.address));
      setRows((rs) => rs!.map((r) => {
        const idx = valid.findIndex((v) => v.address === r.address);
        return idx >= 0 ? { ...r, holder: res[idx] } : r;
      }));
    } catch (e) { setErr((e as Error).message); }
  }

  async function distribute() {
    if (!address) return;
    setBusy(true);
    setErr("");
    try {
      const { signer } = await connectWallet();
      const c = new ethers.Contract(config!.distributor!, ABI, signer);
      const recipients = valid.map((r) => r.address);
      const amounts = valid.map((r) => ethers.parseEther(r.amount));
      const value = amounts.reduce((a, b) => a + b, 0n);
      const tx = await c.distribute(ethers.ZeroAddress, recipients, amounts, { value });
      await tx.wait();
      setDone({ tx: tx.hash });
    } catch (e) {
      setErr((e as Error).message?.slice(0, 160) ?? "Transaction failed");
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div style={{ padding: "28px 0", maxWidth: 560, margin: "0 auto" }}>
        <div className="card stack center">
          <div className="prize" style={{ fontSize: 24 }}>✅ Distributed</div>
          <p className="muted">Paid every verified Agent-ID holder on your list in one transaction. Anything to a non-holder was refunded to you automatically.</p>
          {config && <a className="link small" href={`${config.explorer}/tx/${done.tx}`} target="_blank" rel="noreferrer">View transaction →</a>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 0", maxWidth: 680, margin: "0 auto" }}>
      <h2 className="page-title">Batch distribution</h2>
      <p className="sub">
        Paste a list of addresses and amounts, and pay them all in one transaction. Only addresses that hold a Binance
        Agent ID are paid — anyone else is skipped and refunded to you. Perfect for crediting a collated list of
        verified winners.
      </p>

      <div className="card stack">
        <div className="field" style={{ margin: 0 }}>
          <label>Recipients — one per line: <span className="mono">address, amount ({sym})</span></label>
          <textarea
            className="input"
            style={{ height: 160, padding: 12, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, resize: "vertical" }}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"0xabc…, 0.5\n0xdef…, 0.25\n0x123…, 1"}
          />
        </div>
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setRows(parseCsv(csv))}>Parse list</button>

        {rows && (
          <>
            <div className="callout" style={{ maxHeight: 220, overflow: "auto" }}>
              {rows.map((r, i) => (
                <div key={i} className="row small" style={{ padding: "4px 0" }}>
                  <span className="mono" style={{ color: r.valid ? "var(--ink)" : "var(--danger)" }}>
                    {r.valid ? shortAddr(r.address) : r.address || "(empty)"}
                  </span>
                  <span className="muted">
                    {r.amount} {sym}
                    {r.holder === true && <span className="ok"> · ✓ holder</span>}
                    {r.holder === false && <span className="err"> · will skip</span>}
                  </span>
                </div>
              ))}
            </div>
            <div className="row">
              <span className="muted small">{valid.length} valid · total <b style={{ color: "var(--ink)" }}>{total} {sym}</b></span>
              {address && <button className="btn btn-ghost" onClick={check}>Check Agent IDs</button>}
            </div>
          </>
        )}

        <div className="divider" />
        {!address ? (
          <button className="btn btn-ghost" onClick={connect}>Connect wallet</button>
        ) : (
          <div className="row">
            <span className="small muted">Paying from <span className="mono">{shortAddr(address)}</span></span>
            <button className="btn btn-primary" onClick={distribute} disabled={busy || valid.length === 0}>
              {busy ? <span className="spinner" /> : `Distribute ${total} ${sym}`}
            </button>
          </div>
        )}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
