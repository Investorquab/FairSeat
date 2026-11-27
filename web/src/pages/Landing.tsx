import { useConfig } from "../App";
import { shortAddr } from "../lib";

const TELEGRAM = "https://t.me/getfairseat_bot";

// A fixed seat map for the hero: most seats dim, a few taken, exactly one lit = "your seat".
const COLS = 8;
const ROWS = 6;
const TAKEN = new Set([2, 5, 9, 14, 17, 21, 26, 30, 33, 38, 41, 44]);
const LIT = 19;

function SeatBoard() {
  const cells = Array.from({ length: COLS * ROWS }, (_, i) => i);
  return (
    <div className="seatboard" data-enter="3">
      <div className="screen" />
      <div className="seatmap" style={{ ["--cols" as any]: COLS }}>
        {cells.map((i) => (
          <div
            key={i}
            className={`seat-cell ${i === LIT ? "lit" : TAKEN.has(i) ? "taken" : ""}`}
            data-rise
            style={{ animationDelay: `${0.2 + (i % COLS) * 0.015 + Math.floor(i / COLS) * 0.03}s` }}
          />
        ))}
      </div>
      <div className="seatboard-foot">
        <span>One seat per Agent ID</span>
        <span className="yours"><i /> your seat</span>
      </div>
    </div>
  );
}

export function Landing() {
  const config = useConfig();
  const chainName = config ? (config.chainId === 56 ? "BNB Chain" : "BNB testnet") : "BNB Chain";
  const explorer = config?.explorer ?? "https://bscscan.com";

  const contracts = config
    ? [
        { k: "Giveaway vault", a: config.vault, note: "Locks every prize on-chain" },
        { k: "Agent ID verifier", a: config.verifier, note: "Proves one seat per ID" },
        { k: "Poll", a: config.poll, note: "One Agent ID, one vote" },
        { k: "Batch distributor", a: config.distributor, note: "Pays a verified list in one tx" },
      ].filter((c): c is { k: string; a: string; note: string } => Boolean(c.a))
    : [];

  return (
    <div className="lp">
      <header className="header">
        <div className="container">
          <a href="#/" className="brand">
            <span className="seatmark" />
            FairSeat
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <a className="nav" href={TELEGRAM} target="_blank" rel="noreferrer" style={{ color: "var(--muted)", fontWeight: 500, fontSize: 15, padding: "8px 10px" }}>
              Telegram
            </a>
            <a href="#/app" className="btn btn-primary">Open FairSeat</a>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="wrap">
          <div>
            <div className="eyebrow" data-enter><span className="dot" /> Binance Agent ID · {chainName}</div>
            <h1 data-enter="2">One Agent ID.<br />One seat.</h1>
            <p className="lead" data-enter="2">
              Community giveaways, votes and payouts where every Binance Agent ID counts exactly once.
              Prizes are locked on-chain, winners are drawn provably-fair, and anyone can check the result -
              no sign-ups, no multi-wallet farming.
            </p>
            <div className="cta-row" data-enter="4">
              <a href="#/app" className="btn btn-primary btn-lg">Open FairSeat</a>
              <a href="#/check" className="btn btn-ghost btn-lg">Check a draw</a>
            </div>
          </div>
          <SeatBoard />
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h2>How it works</h2>
            <p>Three steps, once. After that, joining anything is a single tap.</p>
          </div>
          <div className="how">
            <div className="how-step">
              <h3>Verify your Agent ID</h3>
              <p>Send one tiny transaction from your Binance AI wallet to prove you hold an Agent ID. No keys, no login - you confirm it yourself, and the dust is refunded.</p>
            </div>
            <div className="how-step">
              <h3>Take your seat</h3>
              <p>Join a giveaway or cast a vote with one tap. Your Agent ID is counted once; a second wallet can't take a second seat.</p>
            </div>
            <div className="how-step">
              <h3>Win, paid on-chain</h3>
              <p>When a giveaway closes, winners come from a future block hash and are paid automatically from the locked vault. Nobody can withhold the prize.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h2>What you can run</h2>
            <p>Hosts fund and launch in minutes. Everyone joins with the same one seat.</p>
          </div>
          <div className="runs">
            <div className="card run">
              <div className="run-k">Giveaways</div>
              <p>Lock a BNB or token prize, pick first-come, random, or split-equally, and let verified holders enter. Winners are paid the moment it resolves.</p>
            </div>
            <div className="card run">
              <div className="run-k">Votes</div>
              <p>Ask your community a question where each Agent ID gets exactly one vote. The tally is public and can't be stuffed.</p>
            </div>
            <div className="card run">
              <div className="run-k">Distribute</div>
              <p>Pay a whole list of verified holders in a single transaction. Anyone without an Agent ID is skipped and refunded.</p>
            </div>
          </div>
        </div>
      </section>

      {contracts.length > 0 && (
        <section className="section">
          <div className="wrap">
            <div className="section-head">
              <h2>Nothing to trust - everything to check</h2>
              <p>FairSeat holds no owner key over your funds. Every contract is live and verified on {chainName}.</p>
            </div>
            <div className="trust-grid">
              {contracts.map((c) => (
                <a key={c.a} className="trust-row" href={`${explorer}/address/${c.a}#code`} target="_blank" rel="noreferrer">
                  <span className="k">
                    <b>{c.k}</b>
                    <span>{c.note} · {shortAddr(c.a)}</span>
                  </span>
                  <span className="go">View on BscScan</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h2>Questions</h2>
            <p>The short version: one Agent ID, one seat, and you stay in control.</p>
          </div>
          <div className="faq">
            <details className="guide">
              <summary>I verified on my phone. Will it know me on my computer?</summary>
              <p>On Telegram, yes automatically: your seat is tied to your Telegram account, so any device you are signed into already works. On the website, verifying once gives you a private <b>seat key</b>. Paste it under "Already verified on another device" on the new device (or send it to the bot as <span className="mono">/restore &lt;key&gt;</span>) and your seat moves over instantly, with no re-verifying.</p>
            </details>
            <details className="guide">
              <summary>Do I connect a wallet or sign anything?</summary>
              <p>No. You never connect a wallet, sign a message, or hand over a key. You verify by making one tiny transfer yourself, and you confirm every action in your own wallet.</p>
            </details>
            <details className="guide">
              <summary>What does verifying cost?</summary>
              <p>Almost nothing. You send a tiny amount of BNB (a fraction of a cent) to the verifier, and it is refunded. You only pay the network's gas fee for the transfer.</p>
            </details>
            <details className="guide">
              <summary>Can someone with lots of wallets win more often?</summary>
              <p>No. Every entry, vote and payout is counted once per Agent ID, checked on-chain. A second wallet gets no second seat. The one limit: this is as strong as Binance's own KYC, so it cannot stop someone running several real Binance accounts.</p>
            </details>
            <details className="guide">
              <summary>Can FairSeat take the prize money?</summary>
              <p>No. A giveaway's prize is locked in a contract with no owner who can withdraw it. It can only go to winners who hold an Agent ID, or back to the host. Every contract is open-source and verified on BscScan.</p>
            </details>
            <details className="guide">
              <summary>How are winners chosen, and can I check?</summary>
              <p>Random winners come from a future block hash, with the entrant list fixed before that block exists, so the draw cannot be re-rolled. Anyone can recompute the winners on the <a className="link" href="#/check">Check a draw</a> page.</p>
            </details>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap foot-row">
          <div className="brand"><span className="seatmark" /> FairSeat</div>
          <div style={{ display: "flex", gap: 18 }}>
            <a className="link" href="#/app">Open app</a>
            <a className="link" href="#/check">Check a draw</a>
            <a className="link" href={TELEGRAM} target="_blank" rel="noreferrer">Telegram bot</a>
          </div>
        </div>
        <div className="wrap" style={{ marginTop: 14, color: "var(--faint)", fontSize: 13 }}>
          One Agent ID, one seat. You confirm every transaction in your own wallet - FairSeat never asks for keys or logins.
        </div>
      </footer>
    </div>
  );
}
