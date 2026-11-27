import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useConfig } from "../App";
import { shortAddr } from "../lib";

const TOKEN_KEY = "fairseat_web_token";
const WALLET_KEY = "fairseat_web_wallet";

export function getWebIdentity(): { token: string; wallet: string } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const wallet = localStorage.getItem(WALLET_KEY);
    return token && wallet ? { token, wallet } : null;
  } catch {
    return null;
  }
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

export function Verify({ onVerified }: { onVerified?: (wallet: string) => void }) {
  const config = useConfig();
  const [identity, setIdentity] = useState(getWebIdentity());
  const [session, setSession] = useState<{ token: string; amount: string; verifier: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [restore, setRestore] = useState("");
  const [restoreErr, setRestoreErr] = useState("");
  const poll = useRef<number | null>(null);

  useEffect(() => {
    if (identity) onVerified?.(identity.wallet);
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  async function start() {
    setBusy(true);
    setErr("");
    try {
      const s = await api.verifyStart();
      setSession({ token: s.token, amount: s.amount, verifier: s.verifier });
      poll.current = window.setInterval(async () => {
        const st = await api.verifyStatus(s.token);
        if (st.verified && st.wallet) {
          window.clearInterval(poll.current!);
          try {
            localStorage.setItem(TOKEN_KEY, s.token);
            localStorage.setItem(WALLET_KEY, st.wallet);
          } catch {
            /* ignore */
          }
          setIdentity({ token: s.token, wallet: st.wallet });
        }
      }, 4000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doRestore() {
    const token = restore.trim();
    setRestoreErr("");
    if (!token) return;
    try {
      const st = await api.verifyStatus(token);
      if (st.verified && st.wallet) {
        try {
          localStorage.setItem(TOKEN_KEY, token);
          localStorage.setItem(WALLET_KEY, st.wallet);
        } catch {
          /* ignore */
        }
        setIdentity({ token, wallet: st.wallet });
      } else {
        setRestoreErr("That seat key isn't verified yet. Check it, or verify below.");
      }
    } catch (e) {
      setRestoreErr((e as Error).message);
    }
  }

  if (identity) {
    return (
      <div className="callout stack">
        <div className="row">
          <div>
            <div className="small muted">Verified Agent ID wallet</div>
            <div className="mono" style={{ fontWeight: 600 }}>{shortAddr(identity.wallet)}</div>
          </div>
          <span className="badge badge-open">✓ verified</span>
        </div>
        <details className="guide">
          <summary>Use your seat on another device</summary>
          <div className="small muted" style={{ marginTop: 8 }}>
            Copy your seat key and paste it into "Restore" on the other device. Keep it private: it is your seat (entries and votes only, never funds).
          </div>
          <div className="code" style={{ marginTop: 8 }}>
            <span className="mono">{identity.token}</span>
            <Copy text={identity.token} />
          </div>
        </details>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="callout stack">
        <div>
          <strong>Verify once with your Binance Agent ID</strong>
          <div className="small muted" style={{ marginTop: 4 }}>
            One tiny transaction from your Binance AI wallet proves you hold an Agent ID. No keys, no login - you confirm it yourself, and the dust is refunded.
          </div>
        </div>
        <button className="btn btn-primary" onClick={start} disabled={busy}>
          {busy ? <span className="spinner" /> : "Verify with Agent ID"}
        </button>
        {err && <div className="err">{err}</div>}
        <details className="guide">
          <summary>Already verified on another device?</summary>
          <div className="small muted" style={{ marginTop: 8 }}>
            Paste the seat key from your verified device to restore your seat here. No re-verifying.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              className="input"
              placeholder="your seat key"
              value={restore}
              onChange={(e) => setRestore(e.target.value)}
            />
            <button className="btn btn-ghost" onClick={doRestore} disabled={!restore.trim()}>Restore</button>
          </div>
          {restoreErr && <div className="err" style={{ marginTop: 8 }}>{restoreErr}</div>}
        </details>
      </div>
    );
  }

  const sym = config?.nativeSymbol ?? "BNB";
  const command = `Send ${session.amount} ${sym} to ${session.verifier} on BNB Chain`;
  return (
    <div className="callout stack">
      <strong>Send one tiny transaction from your Binance AI wallet</strong>
      <div>
        <div className="small muted" style={{ marginBottom: 6 }}>Paste this into Binance AI and it sends it for you:</div>
        <div className="code">
          <span>{command}</span>
          <Copy text={command} />
        </div>
      </div>
      <div className="small muted">Or send it yourself:</div>
      <ol className="steps">
        <li>
          Add this contract to your <b>Address Book</b>:
          <div className="code" style={{ marginTop: 6 }}>
            <span>{session.verifier}</span>
            <Copy text={session.verifier} />
          </div>
        </li>
        <li>
          Send <b>exactly</b> this amount to it:
          <div className="code" style={{ marginTop: 6 }}>
            <span>
              {session.amount} {sym}
            </span>
            <Copy text={session.amount} />
          </div>
        </li>
        <li>Keep this page open - it confirms automatically and refunds the dust.</li>
      </ol>
      <div className="small muted">
        You can send from the Binance app's on-chain withdrawal (Binance Pro) or any wallet that holds your Agent ID - on the BNB&nbsp;Chain network.
      </div>
      <details className="guide">
        <summary>How do I add it to my Binance Address Book?</summary>
        <ol>
          <li>Open the Binance app and go to your <b>Binance Wallet</b>.</li>
          <li>Tap the <b>menu icon at the top-right</b> of the wallet screen.</li>
          <li>Scroll down and open <b>Address Book</b>.</li>
          <li>Tap <b>Add address</b>, choose <b>BNB Chain</b>, paste the address above, label it "FairSeat", and save.</li>
          <li>Back in the wallet, <b>Send</b> the exact amount to your saved "FairSeat" address.</li>
        </ol>
      </details>
      <div className="row">
        <span className="small muted">
          <span className="spinner" style={{ marginRight: 8 }} /> waiting for your transaction…
        </span>
      </div>
    </div>
  );
}
