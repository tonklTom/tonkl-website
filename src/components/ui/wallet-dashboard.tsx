"use client";

import React, { useState } from "react";
import {
  Maximize,
  Hexagon,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowRight,
  MessageCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  Loader2,
  Layers,
  Shield,
  Database,
  Eye,
  EyeOff,
  Droplet,
  Coins,
} from "lucide-react";
import { motion } from "framer-motion";
import * as Avatar from "@radix-ui/react-avatar";
import { useTonkl } from "@/hooks/use-tonkl";

export function WalletDashboard({ onClose }: { onClose: () => void }) {
  const { connected, loading, chain, wallet, error, lastUpdated, refresh } =
    useTonkl();

  const [showUSD, setShowUSD] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);

  // TNKL to USD mock conversion rate
  const TNKL_PRICE = 4.20;

  // Compute final display balance based on toggles
  let finalBalance = "—";
  let finalSymbol = "TNKL";

  if (connected && wallet) {
    const numericBalance = parseFloat(wallet.balance.replace(/,/g, ''));
    if (showUSD) {
      finalBalance = "$" + (numericBalance * TNKL_PRICE).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
      finalSymbol = "USD";
    } else {
      finalBalance = wallet.balance;
      finalSymbol = "TNKL";
    }
  } else if (connected) {
    finalBalance = showUSD ? "$0.00" : "0";
    finalSymbol = showUSD ? "USD" : "TNKL";
  }

  if (hideBalance) {
    finalBalance = "••••••";
  }

  const hasWallet = wallet !== null && wallet.balanceRaw >= 0;

  // Format the last-updated timestamp
  const updatedAgo = lastUpdated
    ? `Updated at ${new Date(lastUpdated).toLocaleTimeString()}`
    : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="min-h-screen w-full bg-[#111111] text-white flex flex-col relative overflow-y-auto"
    >
      {/*
        ========================================
        UPPER SECTION: Frosted Shader Background
        ========================================
      */}
      <div className="relative w-full pt-8 pb-12 overflow-hidden border-b border-white/5">
        {/* Static Image Background */}
        <div className="absolute inset-0 z-0 bg-black pointer-events-none">
          <img 
            src="/dark_ethereal_bg.png" 
            alt="Tonkl Background"
            className="w-full h-full object-cover opacity-80" 
          />
        </div>

        {/* Lighter frosted glass overlay */}
        <div className="absolute inset-0 z-0 bg-[#0a0a0a]/30 backdrop-blur-[30px]" />

        {/* Top Gradient Dimmer */}
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/20 via-transparent to-black/10" />

        <div className="relative z-10 max-w-5xl w-full mx-auto px-6 md:px-12 flex flex-col">
          {/* Top Nav Row */}
          <nav className="flex items-center justify-between w-full mb-16 md:mb-24">
            <div className="flex items-center gap-4">
              <Avatar.Root className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/10 shadow-lg">
                <Avatar.Image
                  className="w-full h-full object-cover"
                  src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop"
                  alt="User Avatar"
                />
                <Avatar.Fallback className="w-full h-full bg-cyan-900/50 flex items-center justify-center text-cyan-400 font-medium">
                  TK
                </Avatar.Fallback>
              </Avatar.Root>
              <div className="flex flex-col">
                <span className="font-medium text-lg text-white/90">
                  Tonkl Alpha
                </span>
                <div className="flex items-center gap-2">
                  {connected ? (
                    <Wifi className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <WifiOff className="w-3 h-3 text-white/30" />
                  )}
                  <span className="text-sm text-white/50 font-mono tracking-wider">
                    {connected ? "Connected" : "Offline"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={refresh}
                className="p-2.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                title="Refresh"
              >
                <RefreshCw
                  className={`w-5 h-5 ${loading ? "animate-spin" : ""}`}
                />
              </button>
              <button className="p-2.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors">
                <Maximize className="w-5 h-5" />
              </button>
              <button className="p-2.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors">
                <Hexagon className="w-5 h-5" />
              </button>
              <div className="w-px h-6 bg-white/10 mx-2" />
              <button
                onClick={onClose}
                className="p-2.5 rounded-full hover:bg-red-500/20 text-white/70 hover:text-red-400 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </nav>

          {/* Balance Area */}
          <div className="flex flex-col mb-12">
            {loading && !chain ? (
              <div className="flex items-center gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-white/30" />
                <span className="text-2xl text-white/40">
                  Connecting to node...
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <h1 className="text-6xl md:text-[6rem] font-light tracking-tight text-white">
                    {finalBalance}
                  </h1>
                  <span className="text-2xl md:text-3xl font-light text-white/40 ml-2 flex items-center gap-2">
                    {finalSymbol}
                    <button 
                      onClick={() => setShowUSD(!showUSD)}
                      className="p-2 hover:bg-white/10 rounded-full transition-colors ml-2 group"
                      title="Toggle Currency"
                    >
                      <ArrowRightLeft className="w-6 h-6 text-white/40 group-hover:text-white" />
                    </button>
                    <button 
                      onClick={() => setHideBalance(!hideBalance)}
                      className="p-2 hover:bg-white/10 rounded-full transition-colors group"
                      title={hideBalance ? "Show Balance" : "Hide Balance"}
                    >
                      {hideBalance ? (
                        <EyeOff className="w-6 h-6 text-white/40 group-hover:text-white" />
                      ) : (
                        <Eye className="w-6 h-6 text-white/40 group-hover:text-white" />
                      )}
                    </button>
                  </span>
                </div>
                {/* Chain info sub-line */}
                {connected && chain && (
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-sm text-white/40 font-mono">
                      Block #{chain.block_height.toLocaleString()}
                    </span>
                    <span className="text-white/20">|</span>
                    <span className="text-sm text-white/40 font-mono">
                      {chain.leaf_count.toLocaleString()} notes
                    </span>
                    {chain.mempool_size > 0 && (
                      <>
                        <span className="text-white/20">|</span>
                        <span className="text-sm text-yellow-400/80 font-mono">
                          {chain.mempool_size} pending
                        </span>
                      </>
                    )}
                  </div>
                )}
                {!connected && !loading && (
                  <div className="flex items-center gap-2 mt-2">
                    <WifiOff className="w-4 h-4 text-white/30" />
                    <span className="text-sm text-white/30">
                      {error || "Node offline"} — showing cached data
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Action Buttons Grid */}
          <div className="grid grid-cols-4 gap-4 md:gap-6 w-full max-w-2xl">
            <button
              onClick={() => window.location.hash = "#send"}
              className="flex flex-col items-center justify-center gap-4 bg-white/5 hover:bg-white/10 border border-white/10 py-8 rounded-[1.5rem] transition-all hover:-translate-y-1 shadow-[0_4px_20px_rgba(0,0,0,0.2)] group"
            >
              <ArrowUpRight className="w-8 h-8 text-cyan-400 group-hover:scale-110 transition-transform" />
              <span className="font-medium text-white/90">Send</span>
            </button>
            <button
              onClick={() => window.location.hash = "#receive"}
              className="flex flex-col items-center justify-center gap-4 bg-white/5 hover:bg-white/10 border border-white/10 py-8 rounded-[1.5rem] transition-all hover:-translate-y-1 shadow-[0_4px_20px_rgba(0,0,0,0.2)] group"
            >
              <ArrowDownLeft className="w-8 h-8 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span className="font-medium text-white/90">Receive</span>
            </button>
            <button
              onClick={() => window.location.hash = "#faucet"}
              className="flex flex-col items-center justify-center gap-4 bg-white/5 hover:bg-white/10 border border-white/10 py-8 rounded-[1.5rem] transition-all hover:-translate-y-1 shadow-[0_4px_20px_rgba(0,0,0,0.2)] group"
            >
              <Droplet className="w-8 h-8 text-yellow-400 group-hover:scale-110 transition-transform" />
              <span className="font-medium text-white/90">Faucet</span>
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('open-tonkl-ai'))}
              className="flex flex-col items-center justify-center gap-4 bg-white/5 hover:bg-white/10 border border-white/10 py-8 rounded-[1.5rem] transition-all hover:-translate-y-1 shadow-[0_4px_20px_rgba(0,0,0,0.2)] group"
            >
              <Coins className="w-8 h-8 text-purple-400 group-hover:scale-110 transition-transform" />
              <span className="font-medium text-white/90 text-center text-sm">Create Token</span>
            </button>
          </div>
        </div>
      </div>

      {/*
        ========================================
        LOWER SECTION: Live Data + Actions
        ========================================
      */}
      <div className="flex-1 w-full bg-[#111111] py-12 pb-32">
        <div className="max-w-5xl w-full mx-auto px-6 md:px-12 grid grid-cols-1 md:grid-cols-2 gap-12">
          {/* Left Column: Actions + Chain Stats */}
          <div className="space-y-10">
            {/* Notes Manager Action */}
            <div className="group cursor-pointer" onClick={() => window.location.hash = "#notes"}>
              <h2 className="text-3xl font-light text-white mb-2 group-hover:text-cyan-400 transition-colors">
                Notes
              </h2>
              <div className="flex items-center justify-between border-b border-white/10 pb-6">
                <p className="text-white/50 text-lg pr-4">
                  Manage unspent UTXOs,
                  <br />
                  merge or split notes.
                </p>
                <ArrowRight className="w-6 h-6 text-white/30 group-hover:text-cyan-400 transition-colors group-hover:translate-x-1" />
              </div>
            </div>

            {/* Staking Action */}
            <div className="group cursor-pointer" onClick={() => window.location.hash = "#staking"}>
              <h2 className="text-3xl font-light text-white mb-2 group-hover:text-cyan-400 transition-colors">
                Staking
              </h2>
              <div className="flex items-center justify-between border-b border-white/10 pb-6">
                <p className="text-white/50 text-lg pr-4">
                  Delegate your TNKL
                  <br />
                  and earn network rewards.
                </p>
                <ArrowRight className="w-6 h-6 text-white/30 group-hover:text-cyan-400 transition-colors group-hover:translate-x-1" />
              </div>
            </div>



            {/* Live Privacy & Network Stats */}
            <div className="pt-4 grid grid-cols-2 gap-4">
              <div className="bg-[#1a1a1a] rounded-2xl p-5 border border-white/5">
                <span className="text-white/40 text-sm block mb-1">
                  <Shield className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                  Shielded Status
                </span>
                {connected ? (
                  <span className="text-emerald-400 font-medium flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Active
                  </span>
                ) : (
                  <span className="text-white/30 font-medium flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                    Offline
                  </span>
                )}
              </div>
              <div className="bg-[#1a1a1a] rounded-2xl p-5 border border-white/5">
                <span className="text-white/40 text-sm block mb-1">
                  <Layers className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                  Network
                </span>
                <span className="text-white/90 font-medium">
                  Tonkl Testnet
                </span>
              </div>
              {connected && chain && (
                <>
                  <div className="bg-[#1a1a1a] rounded-2xl p-5 border border-white/5">
                    <span className="text-white/40 text-sm block mb-1">
                      <Database className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                      Nullifiers
                    </span>
                    <span className="text-white/90 font-medium font-mono">
                      {chain.nullifier_count.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-[#1a1a1a] rounded-2xl p-5 border border-white/5">
                    <span className="text-white/40 text-sm block mb-1">
                      <Database className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                      Merkle Leaves
                    </span>
                    <span className="text-white/90 font-medium font-mono">
                      {chain.leaf_count.toLocaleString()}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Multi-asset balances */}
            {hasWallet && wallet.assets.length > 0 && (
              <div className="pt-2">
                <h3 className="text-lg font-light text-white/60 mb-4">
                  Assets
                </h3>
                <div className="space-y-2">
                  {wallet.assets.map((a) => (
                    <div
                      key={a.assetId}
                      className="flex items-center justify-between p-4 bg-[#1a1a1a] rounded-2xl border border-white/5"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-cyan-400/10 flex items-center justify-center text-cyan-400 text-xs font-bold">
                          {a.symbol.slice(0, 2)}
                        </div>
                        <span className="font-medium text-white/90">
                          {a.symbol}
                        </span>
                      </div>
                      <span className="font-mono text-white/80">
                        {a.balance}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Activity */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-light text-white">
                Recent Activity
              </h3>
              {lastUpdated && (
                <span className="text-xs text-white/30 font-mono">
                  {updatedAgo}
                </span>
              )}
            </div>

            {!connected ? (
              <div className="text-center py-16">
                <WifiOff className="w-10 h-10 text-white/10 mx-auto mb-4" />
                <p className="text-white/30 text-lg">
                  Connect to a Tonkl node
                </p>
                <p className="text-white/20 text-sm mt-1">
                  Activity will appear once the node is reachable
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Live activity will be populated when wallet is connected */}
                {/* For now, show chain activity indicators */}
                {chain && chain.block_height > 0 ? (
                  <>
                    <ActivityItem
                      type="Chain Active"
                      icon={Layers}
                      detail={`Height: ${chain.block_height.toLocaleString()}`}
                      sub="Latest block"
                      color="text-cyan-400"
                      bg="bg-cyan-400/10"
                    />
                    <ActivityItem
                      type="Merkle Tree"
                      icon={Database}
                      detail={`${chain.leaf_count.toLocaleString()} commitments`}
                      sub="Note commitments on-chain"
                      color="text-emerald-400"
                      bg="bg-emerald-400/10"
                    />
                    {chain.nullifier_count > 0 && (
                      <ActivityItem
                        type="Nullifiers"
                        icon={Shield}
                        detail={`${chain.nullifier_count.toLocaleString()} spent`}
                        sub="Notes consumed"
                        color="text-white/70"
                        bg="bg-white/5"
                      />
                    )}
                    {chain.mempool_size > 0 && (
                      <ActivityItem
                        type="Mempool"
                        icon={Loader2}
                        detail={`${chain.mempool_size} pending`}
                        sub="Awaiting block inclusion"
                        color="text-yellow-400"
                        bg="bg-yellow-400/10"
                      />
                    )}
                    {hasWallet && wallet.noteCount > 0 && (
                      <ActivityItem
                        type="Your Notes"
                        icon={Shield}
                        detail={`${wallet.noteCount} unspent`}
                        sub="Shielded UTXOs in wallet"
                        color="text-emerald-400"
                        bg="bg-emerald-400/10"
                      />
                    )}
                  </>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-white/30">
                      No blocks produced yet. Start a testnet to see activity.
                    </p>
                  </div>
                )}
              </div>
            )}

            <button className="w-full mt-4 py-4 text-center text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/5 rounded-2xl transition-colors font-medium">
              View All Transactions
            </button>
          </div>
        </div>
      </div>


    </motion.div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function ActivityItem({
  type,
  icon: Icon,
  detail,
  sub,
  color,
  bg,
}: {
  type: string;
  icon: React.ComponentType<{ className?: string }>;
  detail: string;
  sub: string;
  color: string;
  bg: string;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-2xl hover:bg-[#1a1a1a] transition-colors cursor-pointer group border border-transparent hover:border-white/5">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-full ${bg} ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex flex-col">
          <span className="font-medium text-white/90 text-lg">{type}</span>
          <span className="text-sm text-white/40">{sub}</span>
        </div>
      </div>
      <div className="flex flex-col items-end">
        <span className="font-medium text-white/80 font-mono">{detail}</span>
      </div>
    </div>
  );
}
