"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Droplet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { tonklSessionHeaders } from "@/lib/client-session";

type FaucetStatus = "idle" | "loading-address" | "ready" | "dripping" | "success" | "error";
type PrepareStatus = "idle" | "preparing" | "success";

export function FaucetInline({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<FaucetStatus>("loading-address");
  const [address, setAddress] = useState("");
  const [manualAddress, setManualAddress] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [prepareStatus, setPrepareStatus] = useState<PrepareStatus>("idle");
  const [prepareMsg, setPrepareMsg] = useState("");

  async function loadAddress() {
    try {
      const resp = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tonklSessionHeaders() },
        body: JSON.stringify({ command: "address" }),
      });
      const data = await resp.json();
      const output = data.output || "";

      let addr = "";
      // Try JSON
      try {
        const parsed = JSON.parse(output);
        if (parsed.addresses && parsed.addresses.length > 0) {
          addr = parsed.addresses[0].pk_x;
        }
      } catch {
        // Try text parsing
        const match = output.match(/(0x[0-9a-fA-F]{40,})/);
        if (match) addr = match[1];
      }

      if (addr) {
        setAddress(addr);
      }
    } catch {
      // Not critical — user can enter manually
    }
    setStatus("ready");
  }

  // Auto-load user's address on mount
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAddress();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const handleDrip = async () => {
    const targetAddr = (address || manualAddress).replace(/^0x/, "").trim();

    if (!targetAddr || targetAddr.length < 10) {
      setError("Enter a valid hex address.");
      return;
    }

    setStatus("dripping");
    setError("");

    try {
      const resp = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tonklSessionHeaders() },
        body: JSON.stringify({ address: targetAddr }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        if (resp.status === 429) {
          throw new Error("Rate limited — you can request tokens once per hour.");
        }
        throw new Error(data.message || "Faucet request failed");
      }

      setSuccessMsg(data.message || "Tokens sent!");
      setPrepareStatus("idle");
      setPrepareMsg("");
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Faucet request failed");
      setStatus("error");
    }
  };

  const handlePrepareSpendable = async () => {
    setError("");
    setPrepareStatus("preparing");
    setPrepareMsg("");

    try {
      const resp = await fetch("/api/prepare-spendable", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tonklSessionHeaders() },
        body: JSON.stringify({ assetId: "1" }),
      });
      const data = await resp.json();

      if (!resp.ok || !data.success) {
        throw new Error(data.message || "Could not prepare wallet notes.");
      }

      setPrepareStatus("success");
      setPrepareMsg(data.message || "Wallet is ready for sending.");
    } catch (err) {
      setPrepareStatus("idle");
      setError(err instanceof Error ? err.message : "Could not prepare wallet notes.");
    }
  };

  return (
    <motion.div
      key="faucet-inline"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="w-full min-h-screen bg-[#111111] flex flex-col items-center justify-center px-6 relative"
    >
      {/* Testnet Banner */}
      <div className="absolute top-0 left-0 w-full bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-500/80 py-2 text-center text-sm font-medium">
        Alpha Testnet — Tokens have no real value. Expect bugs.
      </div>

      {/* Back button */}
      <button
        onClick={onBack}
        className="absolute top-16 left-6 flex items-center gap-2 text-white/50 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-5 h-5" /> Back
      </button>

      <div className="max-w-lg w-full flex flex-col items-center">
        <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mb-6 border border-yellow-500/20">
          <Droplet className="w-8 h-8 text-yellow-400" />
        </div>

        <h1 className="text-3xl font-light text-white mb-2">Testnet Faucet</h1>
        <p className="text-white/50 mb-10 text-center">Get free TNKL tokens for testing. Limited to 1 request per address per hour.</p>

        {status === "success" ? (
          <div className="w-full flex flex-col items-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", bounce: 0.5 }}
            >
              <CheckCircle2 className="w-20 h-20 text-emerald-400 mb-6" />
            </motion.div>
            <h2 className="text-2xl font-medium text-white mb-2">Tokens Sent!</h2>
            <p className="text-white/60 text-sm mb-8">{successMsg}</p>
            <div className="w-full bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                {prepareStatus === "success" ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : prepareStatus === "preparing" ? (
                  <Loader2 className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5 animate-spin" />
                ) : (
                  <Droplet className="w-5 h-5 text-cyan-300 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium">
                    {prepareStatus === "success" ? "Ready to send" : "One more step before sending"}
                  </p>
                  <p className="text-white/55 text-sm mt-1">
                    {prepareMsg || "Prepare notes so the shielded transfer circuit has the padding it needs. Your balance stays the same."}
                  </p>
                  {prepareStatus !== "success" && (
                    <button
                      onClick={handlePrepareSpendable}
                      disabled={prepareStatus === "preparing"}
                      className="mt-4 px-4 py-2 bg-cyan-500 disabled:bg-cyan-500/30 text-black disabled:text-white/40 rounded-lg text-sm font-medium hover:bg-cyan-400 transition-colors inline-flex items-center gap-2"
                    >
                      {prepareStatus === "preparing" && <Loader2 className="w-4 h-4 animate-spin" />}
                      {prepareStatus === "preparing" ? "Preparing..." : "Prepare Notes"}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {error && (
              <div className="w-full p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2 mb-6">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <div className="flex gap-4 w-full">
              <button
                onClick={onBack}
                className="flex-1 py-4 bg-cyan-500 text-black font-medium rounded-xl hover:bg-cyan-400 transition-colors"
              >
                Back to Dashboard
              </button>
              <button
                onClick={() => { setStatus("ready"); setSuccessMsg(""); setPrepareStatus("idle"); setPrepareMsg(""); }}
                className="flex-1 py-4 bg-white/5 text-white/70 font-medium rounded-xl hover:bg-white/10 transition-colors"
              >
                Request More
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full space-y-6">
            {/* Address field */}
            <div>
              <label className="text-sm text-white/40 mb-2 block">
                Recipient Address
                {address && <span className="text-emerald-400/60 ml-2">(auto-detected)</span>}
              </label>
              {address ? (
                <div className="bg-[#1a1a1a] border border-emerald-500/20 rounded-xl px-4 py-4">
                  <p className="text-emerald-400 font-mono text-sm break-all">{address}</p>
                </div>
              ) : (
                <input
                  type="text"
                  value={manualAddress}
                  onChange={(e) => { setManualAddress(e.target.value); setError(""); }}
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-4 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 font-mono text-sm"
                  placeholder="0x... (your public key)"
                  disabled={status === "dripping"}
                />
              )}
            </div>

            {/* Amount info */}
            <div className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 flex items-center justify-between">
              <span className="text-white/50">Amount</span>
              <span className="text-white font-medium">100 TNKL</span>
            </div>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Drip button */}
            <button
              onClick={handleDrip}
              disabled={status === "dripping" || status === "loading-address" || (!address && !manualAddress)}
              className="w-full py-4 bg-yellow-500 disabled:bg-yellow-500/30 text-black disabled:text-white/30 font-medium rounded-xl hover:bg-yellow-400 transition-colors flex items-center justify-center gap-2"
            >
              {status === "dripping" ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Generating proof & sending...
                </>
              ) : status === "loading-address" ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading...
                </>
              ) : (
                <>
                  <Droplet className="w-5 h-5" /> Request 100 TNKL
                </>
              )}
            </button>

            <p className="text-center text-white/30 text-xs">
              The faucet generates a ZK proof server-side. This may take 30-60 seconds.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
