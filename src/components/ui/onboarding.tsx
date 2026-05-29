"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Key, ArrowRight, Eye, EyeOff, AlertTriangle, ShieldCheck, Loader2 } from "lucide-react";
import { storeTonklSessionToken } from "@/lib/client-session";

type OnboardingStep = "checking" | "welcome" | "passphrase" | "creating" | "seed" | "verify" | "success";

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [seedRevealed, setSeedRevealed] = useState(false);
  const [error, setError] = useState("");

  // Real wallet data from API
  const [seedWords, setSeedWords] = useState<string[]>([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [pendingSessionToken, setPendingSessionToken] = useState("");

  // Verification states — randomized indices
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifyInputs, setVerifyInputs] = useState(["", "", ""]);
  const [verifyError, setVerifyError] = useState(false);

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
      setPendingSessionToken(typeof data.sessionToken === "string" ? data.sessionToken : "");

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
      storeTonklSessionToken(pendingSessionToken);
      setStep("success");
    } else {
      setVerifyError(true);
    }
  };

  const renderWelcome = () => (
    <motion.div
      key="welcome"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1, duration: 1 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-md w-full flex flex-col items-center text-center relative z-10"
    >
      <h1 className="text-5xl md:text-6xl font-serif font-light text-white mb-6 drop-shadow-xl">
        Welcome <span className="font-serif text-white/80">Λ</span>
      </h1>
      <p className="text-white/60 mb-12 text-lg font-light drop-shadow-md">The privacy-preserving layer. Shield your assets and transact with zero-knowledge.</p>

      <div className="w-full space-y-4">
        <button
          onClick={() => setStep("passphrase")}
          className="w-full py-4 bg-white/5 backdrop-blur-md border border-white/10 text-white/90 font-medium rounded-full hover:bg-white/10 hover:text-white transition-all duration-300"
        >
          Create New Wallet
        </button>
        <button
          onClick={() => window.location.hash = "#restore"}
          className="w-full py-4 bg-white/5 backdrop-blur-md border border-white/10 text-white/90 font-medium rounded-full hover:bg-white/10 hover:text-white transition-all duration-300"
        >
          Restore from Seed Phrase
        </button>
      </div>
    </motion.div>
  );

  const getGreekCipher = (text: string) => {
    const chars = "ΛΣΠΦΞΨΩΘΔΓ";
    return text.split('').map((_, i) => chars[(i * 3) % chars.length]).join('');
  };

  const renderPassphrase = () => (
    <motion.div
      key="passphrase"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="max-w-md w-full relative z-10"
    >
      <div className="mb-10 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/5 border border-white/10 mb-6 backdrop-blur-md shadow-[0_0_30px_rgba(255,255,255,0.05)]">
          <Shield className="w-10 h-10 text-white/80" />
        </div>
        <h2 className="text-4xl font-serif font-light text-white mb-4 tracking-wide">Secure your Vault</h2>
        <p className="text-white/50 font-light max-w-sm mx-auto leading-relaxed">
          Add an optional cryptographic passphrase. This encrypts your zero-knowledge wallet locally.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2 backdrop-blur-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-6">
        <div>
          <label className="text-sm font-serif tracking-widest text-white/40 mb-3 block uppercase">Passphrase</label>
          <div className="relative group w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[inset_0_0_20px_rgba(255,255,255,0.02)] focus-within:border-white/30 focus-within:bg-white/10 transition-all overflow-hidden">
            {/* The visual mask overlay */}
            <div className="absolute inset-0 px-5 py-4 pointer-events-none flex items-center overflow-hidden whitespace-nowrap text-white font-serif tracking-[0.2em] text-lg z-0">
              {passphrase.length === 0 ? (
                <span className="text-white/20 font-sans tracking-normal text-base font-light">Enter a strong passphrase</span>
              ) : (
                showPassphrase ? passphrase : getGreekCipher(passphrase)
              )}
            </div>
            <input
              type="text"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full bg-transparent border-none outline-none px-5 py-4 text-transparent caret-transparent selection:bg-transparent selection:text-transparent transition-all font-serif tracking-[0.2em] text-lg relative z-10"
            />
            <button
              onClick={() => setShowPassphrase(!showPassphrase)}
              className="absolute right-5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors z-20"
            >
              {showPassphrase ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {passphrase.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} 
            animate={{ opacity: 1, y: 0 }}
            className="relative"
          >
            <label className="text-sm font-serif tracking-widest text-white/40 mb-3 block uppercase">Confirm</label>
            <div className={`relative group w-full bg-white/5 backdrop-blur-xl border rounded-2xl shadow-[inset_0_0_20px_rgba(255,255,255,0.02)] focus-within:border-white/30 focus-within:bg-white/10 transition-all overflow-hidden ${
                  confirmPassphrase && passphrase !== confirmPassphrase
                    ? "border-red-500/50 focus-within:border-red-500 bg-red-500/5"
                    : "border-white/10"
                }`}>
              <div className="absolute inset-0 px-5 py-4 pointer-events-none flex items-center overflow-hidden whitespace-nowrap text-white font-serif tracking-[0.2em] text-lg z-0">
                {confirmPassphrase.length === 0 ? (
                  <span className="text-white/20 font-sans tracking-normal text-base font-light">Confirm your passphrase</span>
                ) : (
                  showPassphrase ? confirmPassphrase : getGreekCipher(confirmPassphrase)
                )}
              </div>
              <input
                type="text"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                className="w-full bg-transparent border-none outline-none px-5 py-4 text-transparent caret-transparent selection:bg-transparent selection:text-transparent transition-all font-serif tracking-[0.2em] text-lg relative z-10"
              />
            </div>
          </motion.div>
        )}

        <div className="flex gap-4 pt-6">
          <button
            onClick={() => { setPassphrase(""); createWallet(); }}
            className="flex-1 py-4 bg-transparent border border-white/10 text-white/70 font-medium rounded-2xl hover:bg-white/5 hover:text-white transition-all duration-300"
          >
            Skip
          </button>
          <button
            onClick={createWallet}
            disabled={passphrase.length > 0 && passphrase !== confirmPassphrase}
            className="flex-1 py-4 bg-white/10 backdrop-blur-md border border-white/20 text-white font-medium rounded-2xl hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.05)] group"
          >
            <span className="group-hover:scale-105 inline-block transition-transform">Continue</span>
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
      className="max-w-md w-full flex flex-col items-center text-center relative z-10"
    >
      <div className="w-24 h-24 bg-white/5 backdrop-blur-xl rounded-full flex items-center justify-center mb-10 border border-white/10 shadow-[0_0_40px_rgba(255,255,255,0.05)] relative">
        <Loader2 className="w-10 h-10 text-cyan-400 animate-spin absolute" />
      </div>
      <h2 className="text-4xl font-serif font-light text-white mb-4 tracking-wide">Forging Keys</h2>
      <p className="text-white/50 font-light max-w-sm mx-auto leading-relaxed">
        Generating BIP-39 entropy and deriving your zero-knowledge proofs...
      </p>
    </motion.div>
  );

  const renderSeed = () => (
    <motion.div
      key="seed"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-3xl w-full relative z-10"
    >
      <div className="mb-10 text-center">
        <h2 className="text-4xl font-serif font-light text-white mb-4 tracking-wide">Secret Recovery Phrase</h2>
        <p className="text-white/50 font-light max-w-xl mx-auto leading-relaxed">
          Write down these 24 words in exact order. This is the only key to your vault.
        </p>
      </div>

      <div className="mb-8 p-5 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-4 backdrop-blur-md">
        <div className="p-3 bg-amber-500/20 rounded-full shrink-0">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
        </div>
        <p className="text-amber-500/80 text-sm font-light">
          Never share this phrase with anyone. If you lose this, your funds are gone forever. We cannot recover it for you.
        </p>
      </div>

      <div className="relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 mb-8 overflow-hidden shadow-[inset_0_0_30px_rgba(255,255,255,0.02)]">
        {/* Blur Overlay */}
        {!seedRevealed && (
          <div className="absolute inset-0 z-20 backdrop-blur-2xl bg-[#020202]/80 flex flex-col items-center justify-center transition-all duration-500">
            <div className="w-16 h-16 bg-white/5 border border-white/10 rounded-full flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(255,255,255,0.05)]">
              <Key className="w-8 h-8 text-white/60" />
            </div>
            <p className="text-white/80 font-serif text-xl tracking-widest mb-8 uppercase">Tap to reveal phrase</p>
            <button
              onClick={() => setSeedRevealed(true)}
              className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-medium rounded-2xl transition-all duration-300 flex items-center gap-3 border border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.05)] group"
            >
              <Eye className="w-5 h-5 group-hover:scale-110 transition-transform" /> Reveal Words
            </button>
          </div>
        )}

        <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 transition-opacity duration-1000 ${!seedRevealed ? 'opacity-10 pointer-events-none blur-sm' : 'opacity-100'}`}>
          {seedWords.map((word, i) => (
            <div key={i} className="flex items-center gap-3 bg-white/5 px-4 py-3 rounded-xl border border-white/10 hover:bg-white/10 transition-colors">
              <span className="text-white/30 font-mono text-xs w-5 text-right">{i + 1}.</span>
              <span className="text-white/90 font-medium tracking-wide text-sm">{word}</span>
            </div>
          ))}
        </div>
      </div>

      {walletAddress && (
        <div className="mb-10 p-5 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl flex items-center justify-between backdrop-blur-sm">
          <div>
            <span className="text-xs text-white/40 uppercase tracking-widest block mb-1 font-serif">Your Address</span>
            <span className="text-sm text-emerald-400/90 font-mono tracking-wider">{walletAddress}</span>
          </div>
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
        </div>
      )}

      <button
        onClick={() => setStep("verify")}
        disabled={!seedRevealed}
        className="w-full py-5 bg-white/10 backdrop-blur-md border border-white/20 text-white font-medium rounded-2xl hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.05)] group"
      >
        <span className="group-hover:scale-105 inline-block transition-transform">I&apos;ve written it down safely</span>
      </button>
    </motion.div>
  );

  const renderVerify = () => (
    <motion.div
      key="verify"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-md w-full relative z-10"
    >
      <div className="mb-10 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/5 border border-white/10 mb-6 backdrop-blur-md shadow-[0_0_30px_rgba(255,255,255,0.05)]">
          <ShieldCheck className="w-10 h-10 text-white/80" />
        </div>
        <h2 className="text-4xl font-serif font-light text-white mb-4 tracking-wide">Verify Backup</h2>
        <p className="text-white/50 font-light max-w-sm mx-auto leading-relaxed">
          Let&apos;s make sure you wrote it down correctly. Enter the requested words below.
        </p>
      </div>

      <div className="space-y-6">
        {verifyIndices.map((seedIndex, i) => (
          <div key={i}>
            <label className="text-sm font-serif tracking-widest text-white/40 mb-3 block uppercase">Word #{seedIndex + 1}</label>
            <input
              type="text"
              value={verifyInputs[i]}
              onChange={(e) => {
                const newInputs = [...verifyInputs];
                newInputs[i] = e.target.value.trim().toLowerCase();
                setVerifyInputs(newInputs);
                setVerifyError(false);
              }}
              className="w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all text-lg shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]"
              placeholder={`Enter word #${seedIndex + 1}`}
            />
          </div>
        ))}

        {verifyError && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2 backdrop-blur-md">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Incorrect words. Please check your backup and try again.
          </div>
        )}

        <div className="flex gap-4 pt-6">
          <button
            onClick={() => setStep("seed")}
            className="flex-1 py-4 bg-transparent border border-white/10 text-white/70 font-medium rounded-2xl hover:bg-white/5 hover:text-white transition-all duration-300"
          >
            Back
          </button>
          <button
            onClick={handleVerify}
            className="flex-1 py-4 bg-cyan-500 text-black font-medium rounded-2xl hover:bg-cyan-400 transition-all duration-300 shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)] flex items-center justify-center gap-2 group"
          >
            <ShieldCheck className="w-5 h-5 group-hover:scale-110 transition-transform" /> <span className="group-hover:scale-105 transition-transform">Verify</span>
          </button>
        </div>
      </div>
    </motion.div>
  );

  const renderSuccess = () => (
    <motion.div
      key="success"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-md w-full text-center relative z-10"
    >
      <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-cyan-500/10 border border-cyan-500/30 mb-8 backdrop-blur-xl shadow-[0_0_50px_rgba(34,211,238,0.2)]">
        <ShieldCheck className="w-12 h-12 text-cyan-400" />
      </div>
      <h2 className="text-5xl font-serif font-light text-white mb-6 tracking-wide">Vault Secured</h2>
      <p className="text-white/60 font-light max-w-sm mx-auto leading-relaxed mb-10">
        Your cryptographic keys have been generated and securely encrypted on this device.
      </p>
      
      <button
        onClick={onComplete}
        className="w-full py-5 bg-cyan-500 text-black font-medium rounded-2xl hover:bg-cyan-400 transition-all duration-300 shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)] group"
      >
        <span className="group-hover:scale-105 inline-block transition-transform">Enter Dashboard</span>
      </button>
    </motion.div>
  );

  return (
    <div className="w-full min-h-screen bg-[#020202] flex items-center justify-center px-6 relative overflow-hidden">
      {/* Animated Background layer */}
      <div className="absolute inset-0 z-0 bg-black pointer-events-none overflow-hidden">
        <motion.img
          src="/david_statue_bg.png"
          alt="Tonkl Background"
          initial={{ scale: 1.5, filter: "blur(0px) brightness(1.2)" }}
          animate={{ scale: 1, filter: "blur(16px) brightness(0.6)" }}
          transition={{ duration: 2.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/90" />
      </div>

      {/* Testnet Banner */}
      <div className="absolute top-0 left-0 w-full bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-500/80 py-2 text-center text-sm font-medium z-30">
        Alpha Testnet — Tokens have no real value. Expect bugs.
      </div>

      {/* Top Navigation for Escaping */}
      <nav className="absolute top-10 left-0 w-full px-8 py-6 flex items-center justify-start z-50 pointer-events-auto">
        <button 
          onClick={() => { window.location.hash = "#home"; }}
          className="flex items-center gap-2 text-white/50 hover:text-white transition-colors group"
        >
          <ArrowRight className="w-4 h-4 rotate-180 group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">Back to Home</span>
        </button>
      </nav>

      <AnimatePresence mode="wait">
        {step === "welcome" && renderWelcome()}
        {step === "passphrase" && renderPassphrase()}
        {step === "creating" && renderCreating()}
        {step === "seed" && renderSeed()}
        {step === "verify" && renderVerify()}
        {step === "success" && renderSuccess()}
      </AnimatePresence>
    </div>
  );
}
