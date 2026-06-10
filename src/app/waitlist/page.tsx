"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PixelTrail } from "@/components/ui/pixel-trail";
import { GooeyFilter } from "@/components/ui/gooey-filter";
import { TetrisGlassFall } from "@/components/ui/tetris-glass-fall";
import { useScreenSize } from "@/hooks/use-screen-size";

const getGreekCipher = (text: string) => {
  const greekChars = ['Λ', 'Σ', 'Π', 'Φ', 'Ξ', 'Ψ', 'Ω', 'Θ', 'Δ', 'Γ'];
  return text.split('').map((char) => {
    if (char === ' ') return ' ';
    const charCode = char.charCodeAt(0);
    return greekChars[charCode % greekChars.length];
  }).join('');
};

export default function WaitlistPage() {
  const screenSize = useScreenSize();
  const [step, setStep] = useState<"initial" | "email" | "joined">("initial");
  const [joinedText, setJoinedText] = useState("SUCCESS");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch live waitlist count on mount
  useEffect(() => {
    fetch("/api/waitlist")
      .then((r) => r.json())
      .then((d) => { if (typeof d.count === "number") setWaitlistCount(d.count); })
      .catch(() => {});
  }, []);

  const handleSubmit = async () => {
    setError("");
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Something went wrong.");
        setSubmitting(false);
        return;
      }
      if (typeof data.count === "number") setWaitlistCount(data.count);
      setJoinedText("SUCCESS");
      setStep("joined");
    } catch {
      setError("Network error. Try again.");
    }
    setSubmitting(false);
  };

  useEffect(() => {
    if (step === "joined") {
      const timer1 = setTimeout(() => {
        setJoinedText(getGreekCipher("SUCCESS"));
      }, 1500);

      const timer2 = setTimeout(() => {
        setStep("initial");
      }, 3000);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
      };
    }
  }, [step]);

  return (
    <main className="relative bg-[#020202] min-h-screen w-full overflow-hidden flex items-center justify-center">
      {/* Background Layer */}
      <div className="absolute inset-0 z-0">
        <motion.img
          src="/david_statue_bg.png"
          alt="Tonkl Waitlist"
          initial={{ scale: 1.1, filter: "brightness(1.5)" }}
          animate={{ scale: 1, filter: "brightness(1)" }}
          transition={{ duration: 2, ease: "easeOut" }}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/70 pointer-events-none" />
      </div>

      {/* Mouse Trail */}
      <GooeyFilter id="gooey-filter-waitlist" strength={6} />
      <div
        className="absolute inset-0 z-[5]"
        style={{ filter: "url(#gooey-filter-waitlist)" }}
      >
        <PixelTrail
          pixelSize={screenSize.lessThan('md') ? 24 : 32}
          fadeDuration={0}
          delay={500}
          pixelClassName="bg-white rounded-sm"
        />
      </div>

      {/* Falling Tetris Overlay */}
      <div className="absolute inset-0 z-[10] pointer-events-none">
        <TetrisGlassFall />
      </div>

      {/* Content */}
      <div className="relative z-20 flex flex-col items-center justify-center p-8 w-full max-w-md">
        <AnimatePresence mode="wait">
          {step === "initial" && (
            <motion.div
              key="join"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col items-center w-full"
            >
              <button
                onClick={() => setStep("email")}
                className="px-12 py-6 bg-white/10 hover:bg-white/20 text-white font-serif tracking-[0.2em] uppercase text-lg rounded-2xl transition-all duration-300 shadow-[0_0_40px_rgba(255,255,255,0.05)] group border border-white/20 relative overflow-hidden backdrop-blur-md"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_2s_infinite]" />
                <span className="group-hover:scale-105 inline-block transition-transform">Join Waitlist</span>
              </button>
            </motion.div>
          )}

          {step === "email" && (
            <motion.div
              key="email"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col items-center w-full gap-4"
            >
              <input
                type="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                className="w-full bg-white/5 backdrop-blur-xl border border-white/20 rounded-2xl px-6 py-5 text-white focus:outline-none focus:border-cyan-500/50 focus:bg-white/10 transition-all text-center font-serif tracking-widest placeholder:text-white/30 text-lg shadow-[0_0_30px_rgba(255,255,255,0.05)]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
              />
              {error && (
                <p className="text-red-400/80 text-sm font-mono tracking-wide">{error}</p>
              )}
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-4 bg-black text-white font-medium rounded-2xl hover:bg-white/10 transition-all duration-300 border border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.05)] hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] group uppercase tracking-widest font-serif backdrop-blur-md disabled:opacity-50"
              >
                <span className="group-hover:scale-105 inline-block transition-transform">{submitting ? "Joining..." : "Submit"}</span>
              </button>
            </motion.div>
          )}

          {step === "joined" && (
            <motion.div
              key="joined"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col items-center w-full"
            >
              <div className="w-full py-6 bg-black text-white font-serif tracking-[0.2em] uppercase text-lg rounded-2xl flex items-center justify-center gap-3 backdrop-blur-md border border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.1)]">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {joinedText}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-16 w-full max-w-sm px-6 py-3 bg-gradient-to-r from-transparent via-black/60 to-transparent flex justify-center backdrop-blur-sm rounded-xl border-y border-white/5">
          <p className="text-white/40 font-mono tracking-widest text-sm text-center">
            {waitlistCount !== null ? `${(waitlistCount + 349).toLocaleString()} people waiting` : "Join the waitlist"}
          </p>
        </div>
      </div>
    </main>
  );
}
