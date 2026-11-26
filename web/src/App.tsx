import { createContext, useContext, useEffect, useState } from "react";
import { api, type Config } from "./api";
import { Home } from "./pages/Home";
import { GiveawayDetail } from "./pages/GiveawayDetail";
import { Create } from "./pages/Create";
import { VerifyDraw } from "./pages/VerifyDraw";

const ConfigCtx = createContext<Config | null>(null);
export const useConfig = () => useContext(ConfigCtx);

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const h = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return hash;
}

function Header({ route }: { route: string }) {
  const is = (p: string) => (route === p || (p === "#/" && route === "") ? "active" : "");
  return (
    <header className="header">
      <div className="container">
        <a href="#/" className="brand">
          <span className="seat">◧</span>
          <span>
            FairSeat<span className="full" style={{ color: "var(--muted)", fontWeight: 500, fontSize: 13 }}>
              {" "}
              · one seat
            </span>
          </span>
        </a>
        <nav className="nav">
          <a href="#/" className={is("#/")}>Giveaways</a>
          <a href="#/create" className={is("#/create")}>Create</a>
          <a href="#/verify" className={is("#/verify")}>Verify a draw</a>
        </nav>
      </div>
    </header>
  );
}

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
  }, []);
  const route = useHashRoute();

  let page;
  const gMatch = route.match(/^#\/g\/(\d+)/);
  if (gMatch) page = <GiveawayDetail id={Number(gMatch[1])} />;
  else if (route.startsWith("#/create")) page = <Create />;
  else if (route.startsWith("#/verify")) page = <VerifyDraw />;
  else page = <Home />;

  return (
    <ConfigCtx.Provider value={config}>
      <Header route={route.split("?")[0]} />
      <main className="container">{page}</main>
      <footer className="footer">
        <div>FairSeat — one Agent ID, one seat. Running on {config ? (config.chainId === 56 ? "BNB Chain" : "BNB testnet") : "…"}.</div>
        <div style={{ marginTop: 6 }} className="small">
          No keys or logins are ever requested. You confirm every transaction in your own wallet.
        </div>
      </footer>
    </ConfigCtx.Provider>
  );
}
