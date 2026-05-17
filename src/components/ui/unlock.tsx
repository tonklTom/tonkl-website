"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { storeTonklSessionToken } from "@/lib/client-session";

export function Unlock({ onUnlock }: { onUnlock: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState(false);

  // Router already handles: no wallet → onboarding, unencrypted → dashboard
  // If we're here, the wallet exists and needs a passphrase

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsUnlocking(true);
    setError(false);

    try {
      const resp = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unlock",
          passphrase: passphrase || undefined,
        }),
      });

      const data = await resp.json();

      if (resp.ok && data.unlocked) {
        storeTonklSessionToken(data.sessionToken);
        onUnlock();
      } else {
        setError(true);
        setIsUnlocking(false);
        setPassphrase("");
      }
    } catch {
      setError(true);
      setIsUnlocking(false);
      setPassphrase("");
    }
  };

  return (
    <div className="w-full min-h-screen bg-[#111111] flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Testnet Banner */}
      <div className="absolute top-0 left-0 w-full bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-500/80 py-2 text-center text-sm font-medium">
        Alpha Testnet — Tokens have no real value. Expect bugs.
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="max-w-md w-full flex flex-col items-center"
      >
        <div className="w-20 h-20 bg-cyan-500/10 rounded-full flex items-center justify-center mb-8 border border-cyan-500/20 shadow-[0_0_30px_rgba(34,211,238,0.2)]">
          <Lock className="w-10 h-10 text-cyan-400" />
        </div>

        <h1 className="text-4xl font-light text-white mb-2">Unlock Wallet</h1>
        <p className="text-white/50 mb-10 text-center">Enter your passphrase to decrypt your keys and access your dashboard.</p>

        <form onSubmit={handleUnlock} className="w-full space-y-6">
          <motion.div
            animate={error ? { x: [-10, 10, -10, 10, 0] } : {}}
            transition={{ duration: 0.4 }}
            className="relative"
          >
            <div className="relative">
              <input
                type={showPassphrase ? "text" : "password"}
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  if (error) setError(false);
                }}
                disabled={isUnlocking}
                className={`w-full bg-[#1a1a1a] border rounded-xl px-4 py-4 text-white placeholder-white/20 focus:outline-none transition-all ${
                  error ? "border-red-500/50 focus:border-red-500 focus:ring-1 focus:ring-red-500" : "border-white/10 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                }`}
                placeholder="Enter passphrase"
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white disabled:opacity-50"
                disabled={isUnlocking}
              >
                {showPassphrase ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute -bottom-6 left-2 text-sm text-red-400"
                >
                  Incorrect passphrase. Please try again.
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>

          <button
            type="submit"
            disabled={isUnlocking}
            className="w-full py-4 bg-cyan-500 disabled:bg-cyan-500/30 text-black disabled:text-white/30 font-medium rounded-xl hover:bg-cyan-400 transition-colors flex items-center justify-center gap-2"
          >
            {isUnlocking ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> Unlocking...
              </>
            ) : (
              "Unlock"
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button
            onClick={() => window.location.hash = "#restore"}
            className="text-sm text-cyan-400/80 hover:text-cyan-400 transition-colors"
          >
            Forgot passphrase? Restore from seed phrase
          </button>
        </div>
      </motion.div>
    </div>
  );
}
