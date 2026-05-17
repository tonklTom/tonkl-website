"use client";

import { useState, useEffect, useCallback } from "react";
import WarpShaderHero from "@/components/ui/wrap-shader";
import { WalletDashboard } from "@/components/ui/wallet-dashboard";
import { NewsDashboard } from "@/components/ui/news-dashboard";
import { Onboarding } from "@/components/ui/onboarding";
import { Unlock } from "@/components/ui/unlock";
import { Send } from "@/components/ui/send";
import { Receive } from "@/components/ui/receive";
import { FaucetInline } from "@/components/ui/faucet-inline";
import { AnimatePresence } from "framer-motion";
import { getTonklSessionToken, storeTonklSessionToken } from "@/lib/client-session";

// Pages that require a wallet to exist
const WALLET_PAGES = new Set(["wallet", "dashboard", "send", "receive", "faucet", "unlock"]);

export default function Home() {
  const [activePage, setActivePage] = useState<string>("loading");

  const navigateTo = useCallback((page: string) => {
    setActivePage(page);
    window.history.pushState(null, '', page === "home" ? "/" : `/#${page}`);
  }, []);

  // Single wallet check on mount + hash change
  useEffect(() => {
    const resolveRoute = async (hash: string) => {
      const page = hash || "home";

      // If navigating to a wallet-required page, check wallet first
      if (WALLET_PAGES.has(page)) {
        try {
          const resp = await fetch("/api/onboard", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "check" }),
          });
          const data = await resp.json();

          if (!data.exists) {
            // No wallet — always go to onboarding
            setActivePage("onboarding");
            window.history.replaceState(null, '', '/#onboarding');
            return;
          }

          // Wallet exists. If there is no browser session yet, try auto-unlock
          // for unencrypted wallets; encrypted wallets should go through unlock.
          if (!getTonklSessionToken()) {
            try {
              const unlockResp = await fetch("/api/onboard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "unlock" }),
              });
              if (unlockResp.ok) {
                const unlockData = await unlockResp.json();
                if (unlockData.unlocked) {
                  storeTonklSessionToken(unlockData.sessionToken);
                  setActivePage("dashboard");
                  window.history.replaceState(null, '', '/#dashboard');
                  return;
                }
              }
            } catch {
              // Needs passphrase — send protected pages through unlock below.
            }

            if (page !== "receive") {
              setActivePage("unlock");
              window.history.replaceState(null, '', '/#unlock');
              return;
            }
          }
        } catch {
          // API not available — let them through
        }
      }

      setActivePage(page);
    };

    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      resolveRoute(hash);
    };

    // Initial load
    handleHashChange();

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const renderPage = () => {
    switch (activePage) {
      case "loading":
        return (
          <div key="loading" className="w-full min-h-screen flex items-center justify-center bg-[#111111]">
            <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        );
      case "home":
        return (
          <div key="home" className="w-full">
            <WarpShaderHero onLaunchWallet={() => navigateTo("wallet")} />
          </div>
        );
      case "wallet":
      case "dashboard":
        return <WalletDashboard key="wallet" onClose={() => navigateTo("home")} />;
      case "news":
        return <NewsDashboard key="news" onClose={() => navigateTo("home")} />;
      case "onboarding":
        return <Onboarding key="onboarding" onComplete={() => navigateTo("dashboard")} />;
      case "unlock":
        return <Unlock key="unlock" onUnlock={() => navigateTo("dashboard")} />;
      case "send":
        return <Send key="send" onBack={() => navigateTo("dashboard")} />;
      case "receive":
        return <Receive key="receive" onBack={() => navigateTo("dashboard")} />;
      case "faucet":
        return <FaucetInline key="faucet" onBack={() => navigateTo("dashboard")} />;
      default:
        return (
          <div key="404" className="w-full min-h-screen flex items-center justify-center bg-[#111111]">
            <h1 className="text-2xl text-white/50">Page Not Found</h1>
          </div>
        );
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-start bg-black text-white w-full">
      <AnimatePresence mode="wait">
        {renderPage()}
      </AnimatePresence>
    </main>
  );
}
