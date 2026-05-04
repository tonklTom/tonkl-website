"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Copy, CheckCircle2, QrCode } from "lucide-react";

export function ReceiveView({ onBack, publicKey }: { onBack: () => void, publicKey: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper to truncate: 0x12345678...abcdef
  const truncateKey = (key: string) => {
    if (!key || key.length < 16) return key;
    return `${key.slice(0, 10)}...${key.slice(-6)}`;
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
        <h2 className="text-3xl font-light text-white">Receive Tokens</h2>
      </div>

      <div className="bg-[#1a1a1a] border border-white/5 rounded-3xl p-8 flex flex-col items-center">
        <p className="text-white/50 text-center mb-8">
          Share this public key to receive TNKL or custom assets. It is completely safe to share and does not reveal your spending key.
        </p>

        {/* Mock QR Code */}
        <div className="w-64 h-64 bg-white rounded-2xl p-4 mb-8 relative flex items-center justify-center">
          {/* We use a placeholder for the QR code for now */}
          <div className="absolute inset-0 m-4 border-[12px] border-black border-dashed opacity-20 rounded-xl pointer-events-none" />
          <QrCode className="w-32 h-32 text-black/80" />
        </div>

        <div className="w-full">
          <label className="text-sm text-white/40 mb-2 block text-center">Your Public Key (pk_x)</label>
          <button
            onClick={handleCopy}
            className="w-full group relative flex items-center justify-between bg-black/40 border border-white/10 rounded-xl p-4 hover:bg-white/5 transition-colors"
          >
            <span className="font-mono text-cyan-400 text-lg tracking-wider">
              {truncateKey(publicKey)}
            </span>
            {copied ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <Copy className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />
            )}
            
            {/* Tooltip */}
            {copied && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute -top-10 left-1/2 -translate-x-1/2 bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-md text-sm border border-emerald-500/30"
              >
                Copied!
              </motion.div>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
