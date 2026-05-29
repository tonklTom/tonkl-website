"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Key, ArrowRight, Eye, EyeOff, AlertTriangle, ShieldCheck, Loader2, BookOpen, Sparkles } from "lucide-react";
import { storeTonklSessionToken } from "@/lib/client-session";

type OnboardingStep = "checking" | "welcome" | "passphrase" | "creating" | "story" | "seed" | "verify" | "success";

// Local-only seed story builder. Seed words must never be sent to a model,
// server route, analytics system, or external process.
function buildSeedStory(words: string[]): { text: string; positions: number[] } {
  const templates = [
    (w: string[]) => `In a land beyond the ${w[0]}, where the ${w[1]} meets the sky, a young wanderer discovered a ${w[2]} of immense ${w[3]}. They carried nothing but ${w[4]} and a quiet ${w[5]} that the path ahead would ${w[6]} into something extraordinary. Through the ${w[7]} of an ancient ${w[8]}, past the ${w[9]} stones of a forgotten ${w[10]}, they found a ${w[11]} inscribed with the word ${w[12]}. It spoke of ${w[13]} and the ${w[14]} that flows between all things. The wanderer learned to ${w[15]} what others could not see — the ${w[16]} patterns hidden in every ${w[17]}. At the ${w[18]} of the journey, standing before a ${w[19]} that shimmered like ${w[20]}, they whispered the final ${w[21]} into the ${w[22]} and felt the ${w[23]} of a thousand silent keys unlocking at once.`,
    (w: string[]) => `The old keeper of the ${w[0]} had one ${w[1]} left to tell. It began with a ${w[2]} falling through ${w[3]}, drifting past ${w[4]} and ${w[5]} until it reached the ${w[6]} below. There, among the ${w[7]}, a creature of pure ${w[8]} waited beside a ${w[9]}. It had guarded the ${w[10]} since the first ${w[11]} was spoken — a word that sounded like ${w[12]}. The creature taught the keeper about ${w[13]}, about the ${w[14]} within every ${w[15]}, and how to ${w[16]} the invisible ${w[17]} that binds the world. When the ${w[18]} finally came, the keeper placed a ${w[19]} upon the ${w[20]}, sealed it with ${w[21]}, and walked into the ${w[22]}. Behind them, the ${w[23]} hummed with new life.`,
    (w: string[]) => `At the edge of the ${w[0]}, a quiet signal called ${w[1]} crossed a sleeping valley. It found a ${w[2]} beside the ${w[3]}, wrapped in ${w[4]} and marked with ${w[5]}. The signal followed a ${w[6]} path through ${w[7]}, where each ${w[8]} carried a memory of ${w[9]}. In the center stood a ${w[10]} that opened only when the word ${w[11]} was spoken. Beyond it, the air tasted of ${w[12]} and the river moved with ${w[13]}. A hidden keeper taught the traveler to ${w[14]} the ${w[15]} between stars, to trust the ${w[16]} beneath every ${w[17]}, and to leave no ${w[18]} behind. When dawn reached the ${w[19]}, the final ${w[20]} became ${w[21]}, and the old ${w[22]} answered with ${w[23]}.`,
  ];
  const templateSeed = words.join("").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const template = templates[templateSeed % templates.length];
  const text = template(words);

  // Find positions
  const textLower = text.toLowerCase();
  const positions: number[] = [];
  let searchFrom = 0;
  for (const word of words) {
    const wordLower = word.toLowerCase();
    let pos = -1;
    while (searchFrom < textLower.length) {
      const idx = textLower.indexOf(wordLower, searchFrom);
      if (idx === -1) break;
      const before = idx === 0 || /[^a-z]/.test(textLower[idx - 1]);
      const after = idx + wordLower.length >= textLower.length || /[^a-z]/.test(textLower[idx + wordLower.length]);
      if (before && after) {
        pos = idx;
        searchFrom = idx + wordLower.length;
        break;
      }
      searchFrom = idx + 1;
    }
    positions.push(pos);
  }
  return { text, positions };
}

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

  // Story states — seed phrase woven into a narrative
  const [storyText, setStoryText] = useState("");
  const [storyRevealed, setStoryRevealed] = useState(false);
  const [storyWordPositions, setStoryWordPositions] = useState<number[]>([]);

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
      setSeedRevealed(false);
      setStoryRevealed(false);
      setVerifyInputs(["", "", ""]);
      setVerifyError(false);

      const story = buildSeedStory(words);
      setStoryText(story.text);
      setStoryWordPositions(story.positions);

      // Pick 3 random indices for verification
      const indices: number[] = [];
      while (indices.length < 3) {
        const idx = Math.floor(Math.random() * 24);
        if (!indices.includes(idx)) indices.push(idx);
      }
      setVerifyIndices(indices.sort((a, b) => a - b));

      // Go to story step — generate a narrative around the seed words
      setStep("story");
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

  // ── Render the story with seed words highlighted ──────────
  const renderStoryContent = () => {
    if (!storyText) return null;

    if (!storyRevealed) {
      // Show the story as plain text — seed words look natural
      return (
        <p className="text-white/70 font-light leading-relaxed text-lg font-serif">
          {storyText}
        </p>
      );
    }

    // Revealed mode — highlight seed words with glow animation
    // Build segments: text before each word, the word itself, text after
    const segments: { text: string; isSeed: boolean; seedIndex: number }[] = [];
    let lastEnd = 0;

    storyWordPositions.forEach((pos, i) => {
      if (pos === -1) return;
      const wordLen = seedWords[i].length;
      if (pos > lastEnd) {
        segments.push({ text: storyText.slice(lastEnd, pos), isSeed: false, seedIndex: -1 });
      }
      segments.push({ text: storyText.slice(pos, pos + wordLen), isSeed: true, seedIndex: i });
      lastEnd = pos + wordLen;
    });
    if (lastEnd < storyText.length) {
      segments.push({ text: storyText.slice(lastEnd), isSeed: false, seedIndex: -1 });
    }

    return (
      <p className="text-white/40 font-light leading-relaxed text-lg font-serif">
        {segments.map((seg, i) =>
          seg.isSeed ? (
            <motion.span
              key={i}
              initial={{ color: "rgba(255,255,255,0.4)", textShadow: "none" }}
              animate={{
                color: "rgba(34,211,238,1)",
                textShadow: "0 0 20px rgba(34,211,238,0.6), 0 0 40px rgba(34,211,238,0.3)",
              }}
              transition={{ delay: seg.seedIndex * 0.12, duration: 0.8, ease: "easeOut" }}
              className="font-medium relative inline"
            >
              {seg.text}
              <motion.span
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: -18 }}
                transition={{ delay: seg.seedIndex * 0.12 + 0.3, duration: 0.5 }}
                className="absolute left-1/2 -translate-x-1/2 text-[10px] font-mono text-cyan-400/60 whitespace-nowrap pointer-events-none"
              >
                {seg.seedIndex + 1}
              </motion.span>
            </motion.span>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </p>
    );
  };

  const renderStory = () => (
    <motion.div
      key="story"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-2xl w-full relative z-10"
    >
      <div className="mb-10 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/5 border border-white/10 mb-6 backdrop-blur-md shadow-[0_0_30px_rgba(255,255,255,0.05)]">
          <BookOpen className="w-10 h-10 text-white/80" />
        </div>
        <h2 className="text-4xl font-serif font-light text-white mb-4 tracking-wide">
          {storyRevealed ? "Your Recovery Phrase" : "A Local Memory Aid"}
        </h2>
        <p className="text-white/50 font-light max-w-lg mx-auto leading-relaxed">
          {storyRevealed
            ? "These 24 glowing words are your seed phrase. Write them down in order."
            : "This story was created on this device. It contains your seed words, so never save, screenshot, or share it."
          }
        </p>
      </div>

      <div className="relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 md:p-10 mb-8 overflow-hidden shadow-[inset_0_0_30px_rgba(255,255,255,0.02)]">
        {renderStoryContent()}
      </div>

      {storyRevealed && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 p-5 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-4 backdrop-blur-md"
        >
          <div className="p-3 bg-amber-500/20 rounded-full shrink-0">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
          </div>
          <p className="text-amber-500/80 text-sm font-light">
            Write down the 24 numbered words in exact order. This story is only a memory aid; your seed phrase is the only key to your vault.
          </p>
        </motion.div>
      )}

      <div className="flex gap-4">
        {!storyRevealed ? (
          <button
            onClick={() => setStoryRevealed(true)}
            className="w-full py-5 bg-white/10 backdrop-blur-md border border-white/20 text-white font-medium rounded-2xl hover:bg-white/20 transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.05)] group flex items-center justify-center gap-3"
          >
            <Sparkles className="w-5 h-5 group-hover:scale-110 transition-transform text-cyan-400" />
            <span className="group-hover:scale-105 inline-block transition-transform">Highlight the 24 Words</span>
          </button>
        ) : (
          <>
            <button
              onClick={() => setStep("seed")}
              className="flex-1 py-5 bg-transparent border border-white/10 text-white/70 font-medium rounded-2xl hover:bg-white/5 hover:text-white transition-all duration-300"
            >
              View as Grid
            </button>
            <button
              onClick={() => setStep("verify")}
              className="flex-1 py-5 bg-cyan-500 text-black font-medium rounded-2xl hover:bg-cyan-400 transition-all duration-300 shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)] group"
            >
              <span className="group-hover:scale-105 inline-block transition-transform">I&apos;ve Written Them Down</span>
            </button>
          </>
        )}
      </div>
    </motion.div>
  );

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
        {step === "story" && renderStory()}
        {step === "seed" && renderSeed()}
        {step === "verify" && renderVerify()}
        {step === "success" && renderSuccess()}
      </AnimatePresence>
    </div>
  );
}
