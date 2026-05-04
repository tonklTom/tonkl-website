"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Key, ArrowRight, Eye, EyeOff, AlertTriangle, ShieldCheck, Loader2 } from "lucide-react";

type OnboardingStep = "checking" | "welcome" | "passphrase" | "creating" | "seed" | "verify";

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<OnboardingStep>("checking");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [seedRevealed, setSeedRevealed] = useState(false);
  const [error, setError] = useState("");

  // Real wallet data from API
  const [seedWords, setSeedWords] = useState<string[]>([]);
  const [walletAddress, setWalletAddress] = useState("");

  // Verification states — randomized indices
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifyInputs, setVerifyInputs] = useState(["", "", ""]);
  const [verifyError, setVerifyError] = useState(false);

  // ── Check if wallet already exists on mount ─────────────────
  // Router already checked wallet state — just show welcome
  useEffect(() => {
    setStep("welcome");
  }, []);

  // ── Create wallet via API ───────────────────────────────────
  const createWallet = useCallback(async () => {
    setStep("creating");
    setError("");

    try {
      const resp = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          passphrase: passphrase || undefined,
        }),
      });

      const data = await resp.json();

      if (!resp.ok || !data.success) {
        // If wallet already exists, redirect to unlock
        if (data.error === "wallet_exists") {
          window.location.hash = "#unlock";
          return;
        }
        throw new Error(data.message || "Failed to create wallet");
      }

      // Store the real seed words
      const words = data.mnemonic.split(" ");
      if (words.length !== 24) {
        throw new Error("Invalid seed phrase received");
      }
      setSeedWords(words);
      setWalletAddress(data.address || "");

      // Pick 3 random indices for verification
      const indices: number[] = [];
      while (indices.length < 3) {
        const idx = Math.floor(Math.random() * 24);
        if (!indices.includes(idx)) indices.push(idx);
      }
      setVerifyIndices(indices.sort((a, b) => a - b));

      setStep("seed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet creation failed");
      setStep("passphrase"); // Go back so they can retry
    }
  }, [passphrase]);

  const handleVerify = () => {
    if (seedWords.length !== 24 || verifyIndices.length !== 3) return;

    const isCorrect = verifyIndices.every((index, i) =>
      verifyInputs[i].trim().toLowerCase() === seedWords[index].toLowerCase()
    );

    if (isCorrect) {
      setVerifyError(false);
      onComplete();
    } else {
      setVerifyError(true);
    }
  };

  const renderWelcome = () => (
    <motion.div
      key="welcome"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-md w-full flex flex-col items-center text-center"
    >
      <div className="w-20 h-20 bg-cyan-500/10 rounded-full flex items-center justify-center mb-8 border border-cyan-500/20 shadow-[0_0_30px_rgba(34,211,238,0.2)]">
        <Shield className="w-10 h-10 text-cyan-400" />
      </div>
      <h1 className="text-4xl font-light text-white mb-4">Welcome to Tonkl</h1>
      <p className="text-white/50 mb-12">The privacy-preserving layer. Shield your assets and transact with zero-knowledge.</p>

      <div className="w-full space-y-4">
        <button
          onClick={() => setStep("passphrase")}
          className="w-full py-4 bg-cyan-500 text-black font-medium rounded-xl hover:bg-cyan-400 transition-colors flex items-center justify-center gap-2 group"
        >
          Create New Wallet
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>
        <button
          onClick={() => window.location.hash = "#restore"}
          className="w-full py-4 bg-white/5 text-white/70 font-medium rounded-xl hover:bg-white/10 hover:text-white transition-colors border border-white/5"
        >
          Restore from Seed Phrase
        </button>
      </div>
    </motion.div>
  );

  const renderPassphrase = () => (
    <motion.div
      key="passphrase"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-md w-full"
    >
      <div className="mb-8">
        <h2 className="text-3xl font-light text-white mb-2">Secure your wallet</h2>
        <p className="text-white/50">Add an optional passphrase. This encrypts your wallet locally on this device.</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-6">
        <div className="relative">
          <label className="text-sm text-white/40 mb-2 block">Passphrase (Optional)</label>
          <div className="relative">
            <input
              type={showPassphrase ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
              placeholder="Enter a strong passphrase"
            />
            <button
              onClick={() => setShowPassphrase(!showPassphrase)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
            >
              {showPassphrase ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {passphrase.length > 0 && (
          <div className="relative">
            <label className="text-sm text-white/40 mb-2 block">Confirm Passphrase</label>
            <input
              type={showPassphrase ? "text" : "password"}
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              className={`w-full bg-[#1a1a1a] border rounded-xl px-4 py-3 text-white focus:outline-none transition-all ${
                confirmPassphrase && passphrase !== confirmPassphrase
                  ? "border-red-500/50 focus:border-red-500"
                  : "border-white/10 focus:border-cyan-500/50"
              }`}
              placeholder="Confirm your passphrase"
            />
          </div>
        )}

        <div className="flex gap-4 pt-4">
          <button
            onClick={() => { setPassphrase(""); createWallet(); }}
            className="flex-1 py-4 bg-white/5 text-white/70 font-medium rounded-xl hover:bg-white/10 transition-colors"
          >
            Skip
          </button>
          <button
            onClick={createWallet}
            disabled={passphrase.length > 0 && passphrase !== confirmPassphrase}
            className="flex-1 py-4 bg-cyan-500 disabled:bg-cyan-500/30 text-black disabled:text-white/30 font-medium rounded-xl hover:bg-cyan-400 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </motion.div>
  );

  const renderCreating = () => (
    <motion.div
      key="creating"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-md w-full flex flex-col items-center text-center"
    >
      <div className="w-20 h-20 bg-cyan-500/10 rounded-full flex items-center justify-center mb-8 border border-cyan-500/20">
        <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
      </div>
      <h2 className="text-3xl font-light text-white mb-4">Creating your wallet</h2>
      <p className="text-white/50">Generating BIP-39 seed phrase and deriving your first spending key...</p>
    </motion.div>
  );

  const renderSeed = () => (
    <motion.div
      key="seed"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-2xl w-full"
    >
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-light text-white mb-2">Secret Recovery Phrase</h2>
          <p className="text-white/50">Write down these 24 words in exact order. If you lose this, your funds are gone forever.</p>
        </div>
        <div className="p-3 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
          <AlertTriangle className="w-6 h-6 text-yellow-500" />
        </div>
      </div>

      <div className="relative bg-[#1a1a1a] border border-white/5 rounded-2xl p-6 mb-8 overflow-hidden">
        {/* Blur Overlay */}
        {!seedRevealed && (
          <div className="absolute inset-0 z-10 backdrop-blur-md bg-[#111]/60 flex flex-col items-center justify-center">
            <Key className="w-8 h-8 text-white/40 mb-4" />
            <p className="text-white/60 font-medium mb-6">Tap to reveal your seed phrase</p>
            <button
              onClick={() => setSeedRevealed(true)}
              className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors flex items-center gap-2"
            >
              <Eye className="w-4 h-4" /> Reveal Words
            </button>
          </div>
        )}

        <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${!seedRevealed ? 'opacity-20 pointer-events-none' : ''}`}>
          {seedWords.map((word, i) => (
            <div key={i} className="flex items-center gap-3 bg-[#222] p-3 rounded-lg border border-white/5">
              <span className="text-white/30 font-mono text-sm min-w-[1.5rem]">{i + 1}.</span>
              <span className="text-white font-medium tracking-wide">{word}</span>
            </div>
          ))}
        </div>
      </div>

      {walletAddress && (
        <div className="mb-6 p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
          <span className="text-xs text-white/40 uppercase tracking-wider block mb-1">Your Address</span>
          <span className="text-sm text-emerald-400 font-mono break-all">{walletAddress}</span>
        </div>
      )}

      <button
        onClick={() => setStep("verify")}
        disabled={!seedRevealed}
        className="w-full py-4 bg-cyan-500 disabled:bg-cyan-500/30 text-black disabled:text-white/30 font-medium rounded-xl hover:bg-cyan-400 transition-colors"
      >
        I've written it down safely
      </button>
    </motion.div>
  );

  const renderVerify = () => (
    <motion.div
      key="verify"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-md w-full"
    >
      <div className="mb-8">
        <h2 className="text-3xl font-light text-white mb-2">Verify Backup</h2>
        <p className="text-white/50">Let's make sure you wrote it down correctly. Enter the requested words below.</p>
      </div>

      <div className="space-y-6">
        {verifyIndices.map((seedIndex, i) => (
          <div key={i}>
            <label className="text-sm text-white/40 mb-2 block">Word #{seedIndex + 1}</label>
            <input
              type="text"
              value={verifyInputs[i]}
              onChange={(e) => {
                const newInputs = [...verifyInputs];
                newInputs[i] = e.target.value.trim().toLowerCase();
                setVerifyInputs(newInputs);
                setVerifyError(false);
              }}
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50"
              placeholder={`Enter word #${seedIndex + 1}`}
            />
          </div>
        ))}

        {verifyError && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Incorrect words. Please check your backup and try again.
          </div>
        )}

        <div className="flex gap-4 pt-4">
          <button
            onClick={() => setStep("seed")}
            className="flex-1 py-4 bg-white/5 text-white/70 font-medium rounded-xl hover:bg-white/10 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleVerify}
            className="flex-1 py-4 bg-cyan-500 text-black font-medium rounded-xl hover:bg-cyan-400 transition-colors flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-5 h-5" /> Verify
          </button>
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="w-full min-h-screen bg-[#111111] flex items-center justify-center px-6 relative overflow-hidden">
      {/* Testnet Banner */}
      <div className="absolute top-0 left-0 w-full bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-500/80 py-2 text-center text-sm font-medium">
        Alpha Testnet — Tokens have no real value. Expect bugs.
      </div>

      <AnimatePresence mode="wait">
        {step === "welcome" && renderWelcome()}
        {step === "passphrase" && renderPassphrase()}
        {step === "creating" && renderCreating()}
        {step === "seed" && renderSeed()}
        {step === "verify" && renderVerify()}
      </AnimatePresence>
    </div>
  );
}
