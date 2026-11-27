import { createContext, useContext, useEffect, useState } from "react";
import { api, type Config } from "./api";
import { Landing } from "./pages/Landing";
import { Giveaways } from "./pages/Giveaways";
import { GiveawayDetail } from "./pages/GiveawayDetail";
import { Create } from "./pages/Create";
import { VerifyDraw } from "./pages/VerifyDraw";
import { Votes } from "./pages/Votes";
import { PollDetail } from "./pages/PollDetail";
import { CreatePoll } from "./pages/CreatePoll";
import { Distribute } from "./pages/Distribute";
import { Verify, getWebIdentity } from "./components/Verify";
import { shortAddr } from "./lib";

const ConfigCtx = createContext<Config | null>(null);
export const useConfig = () => useContext(ConfigCtx);

type Identity = { token: string; wallet: string } | null;
const IdentityCtx = createContext<{ identity: Identity; refresh: () => void }>({ identity: null, refresh: () => {} });
export const useIdentity = () => useContext(IdentityCtx);

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const h = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return hash;
}

function AppHeader({ base, identity }: { base: string; identity: Identity }) {
  const is = (p: string) => (base === p ? "active" : "");
  return (
    <header className="header">
      <div className="container">
        <a href="#/" className="brand">
          <span className="seatmark" />
          <span>FairSeat <span className="tagline">one seat</span></span>
        </a>
        <nav className="nav">
          <a href="#/app" className={is("#/app")}>Giveaways</a>
          <a href="#/votes" className={is("#/votes")}>Votes</a>
          <a href="#/distribute" className={is("#/distribute")}>Distribute</a>
          <a href="#/create" className={is("#/create")}>Create</a>
        </nav>
        {identity ? (
          <a href="#/verify" className="chip on" title="Your verified Agent ID">
            <span className="seatdot" />
            <span className="mono">{shortAddr(identity.wallet)}</span>
          </a>
        ) : (
          <a href="#/verify" className="chip">Verify Agent ID</a>
        )}
      </div>
    </header>
  );
}

function Gate() {
  const { identity, refresh } = useIdentity();
  const cells = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div className="gate">
      <div className="seatmap" style={{ ["--cols" as any]: 8 }} data-enter>
        {cells.map((i) => (
          <div key={i} className={`seat-cell ${i === 11 ? "lit" : [3, 7, 14, 20].includes(i) ? "taken" : ""}`} />
        ))}
      </div>
      <h1 data-enter="2">{identity ? "Your seat" : "Take your seat"}</h1>
      <p className="lead" data-enter="2">
        {identity
          ? "You're verified. Copy your seat key below to use your seat on another device, or to link your Telegram bot with /restore."
          : "FairSeat is for verified Binance Agent IDs. Prove yours once - one tiny transaction, refunded - and every giveaway and vote opens up."}
      </p>
      <div data-enter="3" style={{ textAlign: "left" }}>
        <Verify onVerified={() => refresh()} />
      </div>
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [identity, setIdentity] = useState<Identity>(getWebIdentity());
  const refresh = () => setIdentity(getWebIdentity());
  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
  }, []);
  const route = useHashRoute();
  const base = route.split("?")[0];

  // Public landing - its own chrome.
  if (base === "#/" || base === "") {
    return (
      <ConfigCtx.Provider value={config}>
        <IdentityCtx.Provider value={{ identity, refresh }}>
          <Landing />
        </IdentityCtx.Provider>
      </ConfigCtx.Provider>
    );
  }

  // App surface.
  const gMatch = base.match(/^#\/g\/(\d+)/);
  const pMatch = base.match(/^#\/p\/(\d+)/);
  const isPublic = base.startsWith("#/check") || base.startsWith("#/verify");

  let page;
  if (base.startsWith("#/verify")) page = <Gate />;
  else if (base.startsWith("#/check")) page = <VerifyDraw />;
  else if (gMatch) page = <GiveawayDetail id={Number(gMatch[1])} />;
  else if (pMatch) page = <PollDetail id={Number(pMatch[1])} />;
  else if (base.startsWith("#/create-poll")) page = <CreatePoll />;
  else if (base.startsWith("#/create")) page = <Create />;
  else if (base.startsWith("#/votes")) page = <Votes />;
  else if (base.startsWith("#/distribute")) page = <Distribute />;
  else page = <Giveaways />;

  // Gate everything on the app surface except the public verify/check pages.
  if (!identity && !isPublic) page = <Gate />;

  return (
    <ConfigCtx.Provider value={config}>
      <IdentityCtx.Provider value={{ identity, refresh }}>
        <AppHeader base={base} identity={identity} />
        <main className="container">{page}</main>
        <footer className="footer">
          <div className="container foot-row">
            <div className="muted">FairSeat - one Agent ID, one seat. Live on {config ? (config.chainId === 56 ? "BNB Chain" : "BNB testnet") : "…"}.</div>
            <a className="link" href="#/">← Home</a>
          </div>
        </footer>
      </IdentityCtx.Provider>
    </ConfigCtx.Provider>
  );
}
