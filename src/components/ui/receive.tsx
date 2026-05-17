"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Copy, Check, Loader2, QrCode } from "lucide-react";
import { tonklSessionHeaders } from "@/lib/client-session";

export function Receive({ onBack }: { onBack: () => void }) {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function fetchAddress() {
    try {
      const resp = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tonklSessionHeaders() },
        body: JSON.stringify({ command: "address" }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.message || "Failed to fetch address");
      }

      // Parse the safe address response. It contains public keys only.
      const output = data.output || "";
      let addr = "";

      // Try JSON parse first
      try {
        const parsed = JSON.parse(output);
        if (parsed.addresses && parsed.addresses.length > 0) {
          addr = parsed.addresses[0].pk_x;
        }
      } catch {
        // Fall back to text parsing
        const match = output.match(/(?:Address|pk_x)[:\s]+(0x[0-9a-fA-F]+)/i);
        if (match) {
          addr = match[1];
        } else {
          // Try finding any long hex string
          const hexMatch = output.match(/(0x[0-9a-fA-F]{40,})/);
          if (hexMatch) addr = hexMatch[1];
        }
      }

      if (addr) {
        setAddress(addr);
      } else {
        setError("No keys found. Create a wallet first.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load address");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAddress();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = address;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <motion.div
      key="receive"
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
        <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mb-6 border border-emerald-500/20">
          <QrCode className="w-8 h-8 text-emerald-400" />
        </div>

        <h1 className="text-3xl font-light text-white mb-2">Receive TNKL</h1>
        <p className="text-white/50 mb-10 text-center">Share your public address with the sender. Only your public key is shared — your spending key stays private.</p>

        {loading ? (
          <div className="flex items-center gap-3 text-white/40">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading your address...
          </div>
        ) : error ? (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center w-full">
            {error}
          </div>
        ) : (
          <div className="w-full space-y-6">
            {/* Address display */}
            <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6">
              <span className="text-xs text-white/40 uppercase tracking-wider block mb-3">Your Public Address</span>
              <p className="text-emerald-400 font-mono text-sm break-all leading-relaxed">{address}</p>
            </div>

            {/* Copy button */}
            <button
              onClick={handleCopy}
              className={`w-full py-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                copied
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-cyan-500 text-black hover:bg-cyan-400"
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-5 h-5" /> Copied!
                </>
              ) : (
                <>
                  <Copy className="w-5 h-5" /> Copy Address
                </>
              )}
            </button>

            {/* Info */}
            <div className="text-center text-white/30 text-sm space-y-1">
              <p>Send this address to the person paying you.</p>
              <p>They can paste it into the Send page as your recipient public address.</p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
