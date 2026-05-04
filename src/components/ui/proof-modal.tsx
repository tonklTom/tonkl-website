import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2, Shield, AlertCircle, X } from "lucide-react";

export type ProofStatus = "idle" | "selecting" | "witness" | "proving" | "submitting" | "confirming" | "success" | "error";

interface ProofProgressModalProps {
  isOpen: boolean;
  status: ProofStatus;
  errorMessage?: string;
  txHash?: string;
  onClose: () => void;
  onViewExplorer?: () => void;
}

const steps = [
  { id: "selecting", label: "Selecting notes..." },
  { id: "witness", label: "Building witness..." },
  { id: "proving", label: "Generating zero-knowledge proof..." },
  { id: "submitting", label: "Submitting to network..." },
  { id: "confirming", label: "Waiting for block confirmation..." },
];

const privacyFacts = [
  "Did you know? Zero-knowledge proofs let you prove you have sufficient funds without revealing your balance.",
  "Your transaction details are shielded from the public ledger.",
  "Tonkl uses zk-SNARKs to guarantee privacy and network integrity.",
  "Even node operators cannot see who you are sending tokens to.",
];

export function ProofProgressModal({
  isOpen,
  status,
  errorMessage,
  txHash,
  onClose,
  onViewExplorer,
}: ProofProgressModalProps) {
  const [factIndex, setFactIndex] = useState(0);

  // Cycle privacy facts while proving
  useEffect(() => {
    if (status === "proving") {
      const interval = setInterval(() => {
        setFactIndex((prev) => (prev + 1) % privacyFacts.length);
      }, 3500);
      return () => clearInterval(interval);
    }
  }, [status]);

  if (!isOpen) return null;

  const currentStepIndex = steps.findIndex((s) => s.id === status);
  const isFinished = status === "success" || status === "error";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="bg-[#111] border border-white/10 rounded-3xl p-8 max-w-md w-full shadow-2xl relative overflow-hidden"
        >
          {/* Background gradient glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-cyan-500/10 blur-[50px] rounded-full pointer-events-none" />

          {/* Header */}
          <div className="flex justify-between items-start mb-8 relative z-10">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-full bg-cyan-500/10 text-cyan-400">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-medium text-white">Secure Transfer</h2>
                <p className="text-sm text-white/40">Shielded via ZK Proofs</p>
              </div>
            </div>
            {isFinished && (
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* States */}
          <div className="relative z-10 space-y-8">
            {status === "error" ? (
              <div className="flex flex-col items-center text-center py-6">
                <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">Transaction Failed</h3>
                <p className="text-white/60 text-sm">{errorMessage || "An unknown error occurred during proof generation."}</p>
                <button
                  onClick={onClose}
                  className="mt-8 px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-colors w-full"
                >
                  Dismiss
                </button>
              </div>
            ) : status === "success" ? (
              <div className="flex flex-col items-center text-center py-6">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", bounce: 0.5 }}
                >
                  <CheckCircle2 className="w-20 h-20 text-emerald-400 mb-6" />
                </motion.div>
                <h3 className="text-2xl font-medium text-white mb-2">Transfer Complete</h3>
                <p className="text-white/60 text-sm mb-6">Your transaction was successfully confirmed on the Tonkl network.</p>
                
                {txHash && (
                  <div className="w-full bg-black/40 p-4 rounded-xl border border-white/5 mb-8 flex flex-col gap-1">
                    <span className="text-xs text-white/40 uppercase tracking-wider">Transaction Hash</span>
                    <span className="text-sm text-emerald-400 font-mono truncate">{txHash}</span>
                  </div>
                )}

                <div className="flex gap-4 w-full">
                  <button
                    onClick={onViewExplorer}
                    className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-colors"
                  >
                    View in Explorer
                  </button>
                  <button
                    onClick={onClose}
                    className="flex-1 px-4 py-3 bg-cyan-500 hover:bg-cyan-400 text-black rounded-xl font-medium transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Steps List */}
                <div className="space-y-4">
                  {steps.map((step, idx) => {
                    const isPast = currentStepIndex > idx;
                    const isCurrent = currentStepIndex === idx;
                    
                    return (
                      <div key={step.id} className={`flex items-center gap-4 transition-opacity duration-300 ${isPast || isCurrent ? "opacity-100" : "opacity-30"}`}>
                        <div className="relative flex items-center justify-center w-6 h-6">
                          {isPast ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                          ) : isCurrent ? (
                            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-white/20" />
                          )}
                          {/* Connecting line */}
                          {idx < steps.length - 1 && (
                            <div className={`absolute top-6 left-1/2 w-0.5 h-6 -translate-x-1/2 ${isPast ? "bg-emerald-400/30" : "bg-white/10"}`} />
                          )}
                        </div>
                        <span className={`text-sm ${isCurrent ? "text-white font-medium" : isPast ? "text-white/70" : "text-white/40"}`}>
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Privacy Fact Box */}
                <AnimatePresence mode="wait">
                  {status === "proving" && (
                    <motion.div
                      key={factIndex}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="mt-8 p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/10 text-cyan-200/80 text-sm text-center italic"
                    >
                      {privacyFacts[factIndex]}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
