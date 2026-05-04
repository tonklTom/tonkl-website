"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Send, AlertTriangle } from "lucide-react";
import { ProofProgressModal, ProofStatus } from "@/components/ui/proof-modal";

export function SendView({ onBack, balance }: { onBack: () => void, balance: number }) {
  const [asset, setAsset] = useState("TNKL");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [isProving, setIsProving] = useState(false);
  const [proofStatus, setProofStatus] = useState<ProofStatus>("idle");
  const [txHash, setTxHash] = useState("");

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !recipient) return;

    setIsProving(true);
    setProofStatus("selecting");

    // Simulate ZK Proof generation flow
    setTimeout(() => setProofStatus("witness"), 1000);
    setTimeout(() => setProofStatus("proving"), 2500);
    setTimeout(() => setProofStatus("submitting"), 6000);
    setTimeout(() => setProofStatus("confirming"), 7000);
    setTimeout(() => {
      setTxHash("0x" + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join(''));
      setProofStatus("success");
    }, 9000);
  };

  const handleCloseModal = () => {
    setIsProving(false);
    setProofStatus("idle");
    if (proofStatus === "success") {
      setAmount("");
      setRecipient("");
      onBack();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-xl w-full mx-auto"
    >
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={onBack}
          className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-3xl font-light text-white">Send Tokens</h2>
      </div>

      <form onSubmit={handleSend} className="space-y-6">
        {/* Asset Selection */}
        <div className="bg-[#1a1a1a] rounded-2xl p-2 flex gap-2 border border-white/5">
          {["TNKL", "sUSDC"].map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => setAsset(sym)}
              className={`flex-1 py-3 rounded-xl font-medium transition-colors ${
                asset === sym 
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" 
                  : "text-white/50 hover:bg-white/5"
              }`}
            >
              {sym}
            </button>
          ))}
        </div>

        {/* Amount Input */}
        <div>
          <label className="text-sm text-white/40 mb-2 flex justify-between">
            <span>Amount</span>
            <span className="text-white/60">Available: {balance.toLocaleString()} {asset}</span>
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-4 text-white text-2xl placeholder-white/20 focus:outline-none focus:border-cyan-500/50"
              placeholder="0.00"
              step="any"
              min="0"
            />
            <button 
              type="button"
              onClick={() => setAmount(balance.toString())}
              className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-md transition-colors"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Recipient Input */}
        <div>
          <label className="text-sm text-white/40 mb-2 block">Recipient Address (pk_x)</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-4 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 font-mono text-sm"
            placeholder="0x..."
          />
        </div>

        {/* Fee (Visual only) */}
        <div className="flex justify-between items-center px-4 py-3 bg-white/5 rounded-xl border border-white/5">
          <span className="text-sm text-white/40">Network Fee</span>
          <span className="text-sm text-white/90">0.00 TNKL (Testnet)</span>
        </div>

        {/* Warning if amount exceeds balance */}
        {parseFloat(amount) > balance && asset === "TNKL" && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Insufficient balance
          </div>
        )}

        <button
          type="submit"
          disabled={!amount || !recipient || (parseFloat(amount) > balance && asset === "TNKL")}
          className="w-full py-4 bg-cyan-500 disabled:bg-cyan-500/30 text-black disabled:text-white/30 font-medium rounded-xl hover:bg-cyan-400 transition-colors flex items-center justify-center gap-2 mt-4"
        >
          <Send className="w-5 h-5" /> Shielded Transfer
        </button>
      </form>

      <ProofProgressModal
        isOpen={isProving}
        status={proofStatus}
        txHash={txHash}
        onClose={handleCloseModal}
      />
    </motion.div>
  );
}
