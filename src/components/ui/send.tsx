"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowUpRight, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { ProofProgressModal, type ProofStatus } from "./proof-modal";
import { tonklSessionHeaders } from "@/lib/client-session";

const ADDRESS_PATTERN = /^(0x)?[0-9a-fA-F]{1,64}$/;

export function Send({ onBack }: { onBack: () => void }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [assetId, setAssetId] = useState("1");
  const [error, setError] = useState("");
  const [needsPrep, setNeedsPrep] = useState(false);
  const [prepStatus, setPrepStatus] = useState<"idle" | "preparing" | "success">("idle");
  const [prepMessage, setPrepMessage] = useState("");

  // Proof modal state
  const [proofModalOpen, setProofModalOpen] = useState(false);
  const [proofStatus, setProofStatus] = useState<ProofStatus>("idle");
  const [proofError, setProofError] = useState("");
  const [txHash, setTxHash] = useState("");

  const handleSend = async () => {
    setError("");

    // Validate
    const cleanRecipient = recipient.trim();
    const numAmount = parseInt(amount, 10);

    if (!cleanRecipient) {
      setError("Enter a recipient address.");
      return;
    }
    if (!ADDRESS_PATTERN.test(cleanRecipient)) {
      setError("Invalid address format. Must be a hex public key.");
      return;
    }
    if (!numAmount || numAmount <= 0) {
      setError("Enter a valid amount.");
      return;
    }

    // Open proof modal and start the transfer
    setProofModalOpen(true);
    setProofStatus("selecting");
    setProofError("");
    setTxHash("");

    try {
      // Step through visual states (the actual proving happens server-side)
      // We simulate the step progression while waiting for the API
      setProofStatus("selecting");
      await delay(500);

      setProofStatus("witness");
      await delay(500);

      setProofStatus("proving");

      // Fire the actual send request
      const resp = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tonklSessionHeaders() },
        body: JSON.stringify({
          amount: numAmount,
          recipientAddress: cleanRecipient.replace(/^0x/, ""),
          assetId,
        }),
      });

      const data = await resp.json();

      if (!resp.ok || !data.success) {
        if (data.error === "needs_spendable_pair") {
          setProofModalOpen(false);
          setProofStatus("idle");
          setNeedsPrep(true);
          setPrepStatus("idle");
          setPrepMessage("");
          setError(data.message || "Prepare your wallet notes before sending.");
          return;
        }
        throw new Error(data.message || "Transfer failed");
      }

      setProofStatus("submitting");
      await delay(600);

      setProofStatus("confirming");
      await delay(800);

      setTxHash(data.txHash || "");
      setProofStatus("success");

      // Clear form
      setRecipient("");
      setAmount("");
    } catch (err) {
      setProofError(err instanceof Error ? err.message : "Transfer failed");
      setProofStatus("error");
    }
  };

  const handlePrepareSpendable = async () => {
    setError("");
    setPrepStatus("preparing");
    setPrepMessage("");

    try {
      const resp = await fetch("/api/prepare-spendable", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tonklSessionHeaders() },
        body: JSON.stringify({ assetId }),
      });
      const data = await resp.json();

      if (!resp.ok || !data.success) {
        throw new Error(data.message || "Could not prepare wallet notes.");
      }

      setNeedsPrep(false);
      setPrepStatus("success");
      setPrepMessage(data.message || "Wallet is ready for sending.");
    } catch (err) {
      setPrepStatus("idle");
      setError(err instanceof Error ? err.message : "Could not prepare wallet notes.");
    }
  };

  const handleCloseModal = () => {
    setProofModalOpen(false);
    setProofStatus("idle");
    if (proofStatus === "success") {
      onBack(); // Go back to dashboard on success
    }
  };

  return (
    <>
      <motion.div
        key="send"
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

        <div className="max-w-lg w-full">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 bg-cyan-500/10 rounded-full flex items-center justify-center border border-cyan-500/20">
              <ArrowUpRight className="w-7 h-7 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-3xl font-light text-white">Send</h1>
              <p className="text-white/50">Shielded transfer via ZK proof</p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {(needsPrep || prepStatus !== "idle") && (
            <div className="mb-6 p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
              <div className="flex items-start gap-3">
                {prepStatus === "success" ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : prepStatus === "preparing" ? (
                  <Loader2 className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5 animate-spin" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-cyan-300 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium">
                    {prepStatus === "success" ? "Wallet ready" : "Prepare wallet for sending"}
                  </p>
                  <p className="text-white/55 text-sm mt-1">
                    {prepMessage || "This creates padding notes needed by the shielded transfer circuit. Your balance stays the same."}
                  </p>
                  {prepStatus !== "success" && (
                    <button
                      onClick={handlePrepareSpendable}
                      disabled={prepStatus === "preparing"}
                      className="mt-4 px-4 py-2 bg-cyan-500 disabled:bg-cyan-500/30 text-black disabled:text-white/40 rounded-lg text-sm font-medium hover:bg-cyan-400 transition-colors inline-flex items-center gap-2"
                    >
                      {prepStatus === "preparing" && <Loader2 className="w-4 h-4 animate-spin" />}
                      {prepStatus === "preparing" ? "Preparing..." : "Prepare Notes"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {/* Recipient */}
            <div>
              <label className="text-sm text-white/40 mb-2 block">Recipient Address</label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => { setRecipient(e.target.value); setError(""); setNeedsPrep(false); }}
                className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-4 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all font-mono text-sm"
                placeholder="0x... (recipient public key)"
              />
            </div>

            {/* Amount */}
            <div>
              <label className="text-sm text-white/40 mb-2 block">Amount</label>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(""); setNeedsPrep(false); }}
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-4 pr-20 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all text-lg"
                  placeholder="0"
                  min="1"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 font-medium">
                  {assetId === "1" ? "TNKL" : "sUSDC"}
                </span>
              </div>
            </div>

            {/* Asset selector */}
            <div>
              <label className="text-sm text-white/40 mb-2 block">Asset</label>
              <div className="flex gap-3">
                <button
                  onClick={() => { setAssetId("1"); setNeedsPrep(false); setError(""); }}
                  className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all ${
                    assetId === "1"
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-[#1a1a1a] text-white/50 border border-white/5 hover:border-white/10"
                  }`}
                >
                  TNKL
                </button>
                <button
                  onClick={() => { setAssetId("4"); setNeedsPrep(false); setError(""); }}
                  className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all ${
                    assetId === "4"
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-[#1a1a1a] text-white/50 border border-white/5 hover:border-white/10"
                  }`}
                >
                  sUSDC
                </button>
              </div>
            </div>

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!recipient || !amount}
              className="w-full py-4 bg-cyan-500 disabled:bg-cyan-500/30 text-black disabled:text-white/30 font-medium rounded-xl hover:bg-cyan-400 transition-colors flex items-center justify-center gap-2 text-lg mt-4"
            >
              Send {amount ? `${amount} ${assetId === "1" ? "TNKL" : "sUSDC"}` : ""}
            </button>

            <p className="text-center text-white/30 text-xs">
              This will generate a zero-knowledge proof and submit a shielded transaction. It may take 30-60 seconds.
            </p>
          </div>
        </div>
      </motion.div>

      <ProofProgressModal
        isOpen={proofModalOpen}
        status={proofStatus}
        errorMessage={proofError}
        txHash={txHash}
        onClose={handleCloseModal}
        onViewExplorer={() => {
          handleCloseModal();
          window.location.hash = "#explorer";
        }}
      />
    </>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
