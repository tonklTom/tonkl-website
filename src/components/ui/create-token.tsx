"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Upload, Globe, AtSign, MessageCircle, SendHorizontal,
  Code, Loader2, CheckCircle, AlertTriangle, Shield, Sparkles,
  ChevronDown, ChevronUp, Flame, Heart, Info, XCircle,
  Bot, Pencil,
} from "lucide-react";
import { tonklSessionHeaders } from "@/lib/client-session";
import { maskSecretText } from "@/lib/secret-mask";

// ─── Types ──────────────────────────────────────────────────────

type TokenCategory =
  | "Utility" | "Governance" | "Meme" | "Stablecoin"
  | "Impact" | "Community" | "Gaming" | "RWA" | "Other";

type RiskScore = "low" | "medium" | "high" | "critical";

function RiskBadge({ score }: { score: RiskScore }) {
  const config = {
    low: { color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", label: "Low Risk" },
    medium: { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30", label: "Medium Risk" },
    high: { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30", label: "High Risk" },
    critical: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", label: "Critical Risk" },
  };
  const c = config[score];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${c.color} ${c.bg} border ${c.border}`}>
      <Shield className="w-3 h-3" /> {c.label}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  if (tier === "verified") return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/30">
      <CheckCircle className="w-3 h-3" /> Verified
    </span>
  );
  if (tier === "unverified") return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/30">
      <AlertTriangle className="w-3 h-3" /> Unverified
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-white/60 bg-white/5 border border-white/10">
      Standard
    </span>
  );
}

type TokenFormData = {
  // Identity
  symbol: string;
  name: string;
  description: string;
  category: TokenCategory;
  logoFile: File | null;
  logoPreview: string;
  // Supply
  decimals: number;
  initialSupply: string;
  supplyCap: string;
  // Socials
  website: string;
  twitter: string;
  discord: string;
  telegram: string;
  github: string;
  creatorStatement: string;
  // Advanced
  burnRate: string;
  echoRate: string;
  echoRecipient: string;
};

type CreatedToken = {
  assetId: string;
  symbol: string;
  name: string;
  tier: string;
  riskScore: RiskScore;
  riskDetails: string[];
  metadataComplete: boolean;
};

const CATEGORIES: TokenCategory[] = [
  "Utility", "Governance", "Meme", "Stablecoin",
  "Impact", "Community", "Gaming", "RWA", "Other",
];

const CATEGORY_DESCRIPTIONS: Record<TokenCategory, string> = {
  Utility: "Powers a product or service",
  Governance: "Voting and decision-making",
  Meme: "Community-driven, culture token",
  Stablecoin: "Pegged to a stable asset",
  Impact: "Charity, climate, social good",
  Community: "Social token, fan token",
  Gaming: "In-game currency or item",
  RWA: "Real-world asset representation",
  Other: "Doesn't fit other categories",
};

// ─── Component ──────────────────────────────────────────────────

type CreateMode = "form" | "shlem";

type ShlemMessage = {
  id: string;
  text: string;
  isUser: boolean;
  isLoading?: boolean;
  extractedFields?: Partial<TokenFormData>;
  isPreview?: boolean;
};

export function CreateToken({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<CreateMode>("form");
  const [step, setStep] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shlem chat state
  const [shlemMessages, setShlemMessages] = useState<ShlemMessage[]>([
    { id: "welcome", text: "Tell me about the token you want to create. For example: \"I want to create a community token called VIBE with 10 million supply\" — and I'll handle the rest.", isUser: false },
  ]);
  const [shlemInput, setShlemInput] = useState("");
  const [shlemLoading, setShlemLoading] = useState(false);
  const shlemChatRef = useRef<HTMLDivElement>(null);
  const shlemInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<TokenFormData>({
    symbol: "",
    name: "",
    description: "",
    category: "Utility",
    logoFile: null,
    logoPreview: "",
    decimals: 0,
    initialSupply: "1000000",
    supplyCap: "",
    website: "",
    twitter: "",
    discord: "",
    telegram: "",
    github: "",
    creatorStatement: "",
    burnRate: "0",
    echoRate: "0",
    echoRecipient: "",
  });

  const updateForm = (field: keyof TokenFormData, value: string | number | File | null) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  };

  // ── Logo handling ────────────────────────────────────────────

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 256 * 1024) {
      setError("Logo must be under 256KB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Logo must be an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateForm("logoPreview", reader.result as string);
      updateForm("logoFile", file);
    };
    reader.readAsDataURL(file);
  };

  // ── Shlem chat auto-scroll ──────────────────────────────────

  useEffect(() => {
    if (shlemChatRef.current) {
      shlemChatRef.current.scrollTop = shlemChatRef.current.scrollHeight;
    }
  }, [shlemMessages]);

  // ── Shlem message handler ──────────────────────────────────

  const sendShlemMessage = async () => {
    const text = shlemInput.trim();
    if (!text || shlemLoading) return;

    const userMsg: ShlemMessage = { id: `u-${Date.now()}`, text: maskSecretText(text).text, isUser: true };
    const loadingMsg: ShlemMessage = { id: `l-${Date.now()}`, text: "", isUser: false, isLoading: true };
    setShlemMessages((prev) => [...prev, userMsg, loadingMsg]);
    setShlemInput("");
    setShlemLoading(true);

    try {
      const resp = await fetch("/api/shlem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          context: "token_creation",
          currentForm: form,
          history: shlemMessages
            .filter((m) => !m.isLoading)
            .slice(-10)
            .map((m) => ({ role: m.isUser ? "user" : "assistant", content: m.text })),
        }),
      });

      const data = await resp.json();
      const reply = maskSecretText(data.reply || "I didn't catch that. Could you describe your token again?").text;

      // Check if Shlem extracted any token fields
      const extracted: Partial<TokenFormData> = {};
      if (data.payload?.execution?.data?.extracted_fields) {
        const fields = data.payload.execution.data.extracted_fields;
        if (fields.symbol) extracted.symbol = fields.symbol;
        if (fields.name) extracted.name = fields.name;
        if (fields.description) extracted.description = fields.description;
        if (fields.category) extracted.category = fields.category;
        if (fields.initialSupply) extracted.initialSupply = String(fields.initialSupply);
        if (fields.decimals !== undefined) extracted.decimals = fields.decimals;
        if (fields.burnRate) extracted.burnRate = String(fields.burnRate);
        if (fields.echoRate) extracted.echoRate = String(fields.echoRate);

        // Apply extracted fields to form
        setForm((prev) => ({ ...prev, ...extracted }));
      }

      const hasExtracted = Object.keys(extracted).length > 0;

      setShlemMessages((prev) => [
        ...prev.filter((m) => !m.isLoading),
        {
          id: `s-${Date.now()}`,
          text: reply,
          isUser: false,
          extractedFields: hasExtracted ? extracted : undefined,
        },
      ]);
    } catch {
      setShlemMessages((prev) => [
        ...prev.filter((m) => !m.isLoading),
        { id: `e-${Date.now()}`, text: "Could not reach Shlem. Make sure the service is running.", isUser: false },
      ]);
    } finally {
      setShlemLoading(false);
    }
  };

  // ── Switch to form mode with populated fields ─────────────

  const switchToFormWithFields = () => {
    setMode("form");
    // Jump to review step if we have enough data
    if (form.symbol && form.name && form.initialSupply) {
      setStep(4);
    } else if (form.symbol && form.name) {
      setStep(2);
    }
  };

  // ── Metadata completeness ────────────────────────────────────

  const getCompleteness = (): { score: number; missing: string[] } => {
    const missing: string[] = [];
    if (!form.symbol) missing.push("Symbol");
    if (!form.name) missing.push("Name");
    if (form.description.length < 20) missing.push("Description (20+ chars)");
    if (!form.logoPreview) missing.push("Logo");
    if (!form.website) missing.push("Website");
    if (!form.twitter && !form.discord && !form.telegram) missing.push("At least one social link");
    if (form.creatorStatement.length < 10) missing.push("Creator statement (10+ chars)");

    const total = 7;
    const filled = total - missing.length;
    return { score: Math.round((filled / total) * 100), missing };
  };

  // ── Submit ───────────────────────────────────────────────────

  const handleCreate = async () => {
    setIsCreating(true);
    setError("");

    try {
      const resp = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tonklSessionHeaders() },
        body: JSON.stringify({
          action: "create",
          symbol: form.symbol.toUpperCase(),
          name: form.name,
          decimals: form.decimals,
          initialSupply: parseInt(form.initialSupply) || 0,
          description: form.description,
          category: form.category,
          logoDataUrl: form.logoPreview || undefined,
          website: form.website,
          twitter: form.twitter,
          discord: form.discord,
          telegram: form.telegram,
          github: form.github,
          creatorStatement: form.creatorStatement,
          burnRate: parseInt(form.burnRate) || 0,
          echoRate: parseInt(form.echoRate) || 0,
          echoRecipient: form.echoRecipient || undefined,
          supplyCap: parseInt(form.supplyCap) || 0,
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        setError(data.message || "Token creation failed");
        setIsCreating(false);
        return;
      }

      if (data.warning) {
        setWarning(data.warning);
      }
      setCreatedToken(data.token);
      setStep(5); // Success step
    } catch {
      setError("Network error. Check the node is running.");
    } finally {
      setIsCreating(false);
    }
  };

  // ── Completeness indicator ────────────────────────────────────

  const { score: completeness, missing } = getCompleteness();

  // ─── RENDER ───────────────────────────────────────────────────

  return (
    <div className="w-full min-h-screen bg-[#111111] flex flex-col relative overflow-hidden">
      {/* Testnet Banner */}
      <div className="absolute top-0 left-0 w-full bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-500/80 py-2 text-center text-sm font-medium z-10">
        Alpha Testnet — Tokens have no real value
      </div>

      {/* Header */}
      <div className="pt-14 px-6 pb-4 flex items-center gap-4">
        <button onClick={onBack} className="text-white/50 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-light text-white">Create Token</h1>
          <p className="text-white/40 text-sm">Launch a new token on the Tonkl network</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* Mode toggle */}
          <div className="flex bg-white/5 rounded-xl border border-white/10 p-0.5">
            <button
              onClick={() => setMode("form")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                mode === "form"
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              <Pencil className="w-3 h-3" /> Form
            </button>
            <button
              onClick={() => setMode("shlem")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                mode === "shlem"
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              <Bot className="w-3 h-3" /> Shlem
            </button>
          </div>
          {/* Completeness ring */}
          <div className="relative w-10 h-10">
            <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#333" strokeWidth="2" />
              <circle cx="18" cy="18" r="15.9" fill="none"
                stroke={completeness === 100 ? "#22d3ee" : completeness >= 50 ? "#eab308" : "#ef4444"}
                strokeWidth="2" strokeDasharray={`${completeness} ${100 - completeness}`}
                strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/60 font-medium">
              {completeness}%
            </span>
          </div>
        </div>
      </div>

      {/* Shlem chat mode */}
      {mode === "shlem" && (
        <div className="flex-1 flex flex-col px-6 pb-4 overflow-hidden">
          {/* Chat area */}
          <div ref={shlemChatRef} className="flex-1 overflow-y-auto space-y-4 pb-4 scrollbar-thin scrollbar-thumb-white/10">
            {shlemMessages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.isUser ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.isUser
                    ? "bg-cyan-500/20 text-white border border-cyan-500/20"
                    : "bg-white/5 text-white/80 border border-white/10"
                }`}>
                  {msg.isLoading ? (
                    <div className="flex items-center gap-2 text-purple-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Shlem is thinking...</span>
                    </div>
                  ) : (
                    <>
                      {!msg.isUser && (
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Bot className="w-3.5 h-3.5 text-purple-400" />
                          <span className="text-[10px] text-purple-400/70 font-medium uppercase tracking-wider">Shlem</span>
                        </div>
                      )}
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      {msg.extractedFields && Object.keys(msg.extractedFields).length > 0 && (
                        <div className="mt-3 p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 space-y-1.5">
                          <p className="text-[10px] text-purple-400 font-medium uppercase tracking-wider">Extracted fields</p>
                          {Object.entries(msg.extractedFields).map(([key, val]) => (
                            <div key={key} className="flex justify-between text-xs">
                              <span className="text-white/40 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                              <span className="text-white/70 font-mono">{String(val)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Extracted fields summary + switch to form */}
          {form.symbol && form.name && (
            <div className="mb-3 p-3 rounded-xl bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span className="text-white/60">
                    <span className="text-white/90 font-medium">{form.symbol}</span> — {form.name}
                    {form.initialSupply && parseInt(form.initialSupply) > 0 && (
                      <span className="text-white/40"> ({parseInt(form.initialSupply).toLocaleString()} supply)</span>
                    )}
                  </span>
                </div>
                <button
                  onClick={switchToFormWithFields}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 text-xs font-medium hover:bg-cyan-500/30 transition-colors border border-cyan-500/30"
                >
                  Review & Create
                </button>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="flex gap-2">
            <input
              ref={shlemInputRef}
              type="text"
              value={shlemInput}
              onChange={(e) => setShlemInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendShlemMessage()}
              placeholder="Describe your token to Shlem..."
              disabled={shlemLoading}
              className="flex-1 bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 disabled:opacity-50"
            />
            <button
              onClick={sendShlemMessage}
              disabled={shlemLoading || !shlemInput.trim()}
              className="px-4 py-3 bg-purple-500 disabled:bg-white/10 text-white disabled:text-white/30 rounded-xl hover:bg-purple-400 transition-colors"
            >
              <SendHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Form mode: Step indicator + content */}
      {mode === "form" && <>
      {/* Step indicator */}
      <div className="px-6 pb-6">
        <div className="flex gap-2">
          {["Identity", "Supply", "Socials", "Review"].map((label, i) => (
            <button
              key={label}
              onClick={() => step < 5 && setStep(i + 1)}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                step === i + 1
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : step > i + 1 || step === 5
                  ? "bg-white/5 text-white/40 border border-white/10"
                  : "bg-transparent text-white/20 border border-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 pb-8 overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* ── STEP 1: Identity ────────────────────────────────── */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6 max-w-lg mx-auto">
              {/* Logo */}
              <div className="flex flex-col items-center gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 h-24 rounded-2xl border-2 border-dashed border-white/20 hover:border-cyan-500/50 transition-colors flex items-center justify-center overflow-hidden bg-white/5"
                >
                  {form.logoPreview ? (
                    <img src={form.logoPreview} alt="Logo" className="w-full h-full object-cover rounded-2xl" />
                  ) : (
                    <Upload className="w-8 h-8 text-white/30" />
                  )}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
                <p className="text-white/30 text-xs">Logo (PNG/SVG, max 256KB)</p>
              </div>

              {/* Symbol */}
              <div>
                <label className="block text-white/50 text-sm mb-2">Symbol *</label>
                <input
                  type="text"
                  value={form.symbol}
                  onChange={(e) => updateForm("symbol", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
                  placeholder="MYTKN"
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-lg font-mono placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                  maxLength={10}
                />
                <p className="text-white/20 text-xs mt-1">1-10 alphanumeric characters</p>
              </div>

              {/* Name */}
              <div>
                <label className="block text-white/50 text-sm mb-2">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateForm("name", e.target.value.slice(0, 64))}
                  placeholder="My Custom Token"
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-white/50 text-sm mb-2">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateForm("description", e.target.value.slice(0, 500))}
                  placeholder="What is this token for? What problem does it solve?"
                  rows={3}
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 resize-none"
                />
                <p className="text-white/20 text-xs mt-1">{form.description.length}/500</p>
              </div>

              {/* Category */}
              <div>
                <label className="block text-white/50 text-sm mb-2">Category</label>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => updateForm("category", cat)}
                      className={`py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                        form.category === cat
                          ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                          : "bg-white/5 text-white/40 border border-white/10 hover:border-white/20"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <p className="text-white/20 text-xs mt-2">{CATEGORY_DESCRIPTIONS[form.category]}</p>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!form.symbol || !form.name}
                className="w-full py-3 bg-cyan-500 disabled:bg-white/10 text-black disabled:text-white/30 font-medium rounded-xl hover:bg-cyan-400 transition-colors"
              >
                Next: Supply
              </button>
            </motion.div>
          )}

          {/* ── STEP 2: Supply ──────────────────────────────────── */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6 max-w-lg mx-auto">
              {/* Decimals */}
              <div>
                <label className="block text-white/50 text-sm mb-2">Decimal Places</label>
                <div className="flex gap-2">
                  {[0, 2, 6, 8, 18].map((d) => (
                    <button
                      key={d}
                      onClick={() => updateForm("decimals", d)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                        form.decimals === d
                          ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                          : "bg-white/5 text-white/40 border border-white/10"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <p className="text-white/20 text-xs mt-2">
                  {form.decimals === 0 ? "Whole units only (like TNKL)" :
                   form.decimals === 6 ? "Like USDC (6 decimal places)" :
                   form.decimals === 18 ? "Like ETH (18 decimal places)" :
                   `${form.decimals} decimal places`}
                </p>
              </div>

              {/* Initial Supply */}
              <div>
                <label className="block text-white/50 text-sm mb-2">Initial Supply</label>
                <input
                  type="text"
                  value={form.initialSupply}
                  onChange={(e) => updateForm("initialSupply", e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="1000000"
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white font-mono placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                />
                <p className="text-white/20 text-xs mt-1">
                  {parseInt(form.initialSupply) > 0
                    ? `${parseInt(form.initialSupply).toLocaleString()} ${form.symbol || "tokens"}`
                    : "0 = register without minting"}
                </p>
              </div>

              {/* Supply Cap */}
              <div>
                <label className="block text-white/50 text-sm mb-2">Supply Cap (optional)</label>
                <input
                  type="text"
                  value={form.supplyCap}
                  onChange={(e) => updateForm("supplyCap", e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Leave empty for uncapped"
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white font-mono placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                />
                <p className="text-white/20 text-xs mt-1">Maximum tokens that can ever exist. 0 or empty = unlimited.</p>
              </div>

              {/* Advanced toggle */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between py-3 px-4 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:text-white/70 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm">
                  <Sparkles className="w-4 h-4" /> Advanced Features
                </span>
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-4 overflow-hidden"
                  >
                    {/* Burn Rate */}
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                      <label className="flex items-center gap-2 text-white/50 text-sm">
                        <Flame className="w-4 h-4 text-orange-400" /> Burn Rate (basis points)
                      </label>
                      <input
                        type="text"
                        value={form.burnRate}
                        onChange={(e) => updateForm("burnRate", e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                        placeholder="0"
                        className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm placeholder-white/20 focus:outline-none focus:border-cyan-500/50"
                      />
                      <p className="text-white/20 text-xs">
                        {parseInt(form.burnRate) > 0 ? `${(parseInt(form.burnRate) / 100).toFixed(2)}% burned per transfer` : "No burn"}
                      </p>
                    </div>

                    {/* Echo / Charity */}
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                      <label className="flex items-center gap-2 text-white/50 text-sm">
                        <Heart className="w-4 h-4 text-pink-400" /> Echo / Charity Rate (basis points)
                      </label>
                      <input
                        type="text"
                        value={form.echoRate}
                        onChange={(e) => updateForm("echoRate", e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                        placeholder="0"
                        className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm placeholder-white/20 focus:outline-none focus:border-cyan-500/50"
                      />
                      {parseInt(form.echoRate) > 0 && (
                        <div className="mt-2">
                          <label className="text-white/30 text-xs">Echo recipient address (pk_x)</label>
                          <input
                            type="text"
                            value={form.echoRecipient}
                            onChange={(e) => updateForm("echoRecipient", e.target.value)}
                            placeholder="0x..."
                            className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-xs placeholder-white/20 focus:outline-none focus:border-cyan-500/50 mt-1"
                          />
                        </div>
                      )}
                      <p className="text-white/20 text-xs">
                        {parseInt(form.echoRate) > 0 ? `${(parseInt(form.echoRate) / 100).toFixed(2)}% privately sent to cause per transfer` : "No echo"}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 py-3 bg-white/5 text-white/50 font-medium rounded-xl hover:bg-white/10 transition-colors">
                  Back
                </button>
                <button onClick={() => setStep(3)} className="flex-1 py-3 bg-cyan-500 text-black font-medium rounded-xl hover:bg-cyan-400 transition-colors">
                  Next: Socials
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 3: Socials ─────────────────────────────────── */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5 max-w-lg mx-auto">
              <div className="space-y-4">
                <div>
                  <label className="flex items-center gap-2 text-white/50 text-sm mb-2"><Globe className="w-4 h-4" /> Website</label>
                  <input type="url" value={form.website} onChange={(e) => updateForm("website", e.target.value)} placeholder="https://mytoken.xyz"
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50" />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-white/50 text-sm mb-2"><AtSign className="w-4 h-4" /> X / Twitter</label>
                  <input type="text" value={form.twitter} onChange={(e) => updateForm("twitter", e.target.value)} placeholder="@handle or URL"
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50" />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-white/50 text-sm mb-2"><MessageCircle className="w-4 h-4" /> Discord</label>
                  <input type="text" value={form.discord} onChange={(e) => updateForm("discord", e.target.value)} placeholder="https://discord.gg/..."
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50" />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-white/50 text-sm mb-2"><SendHorizontal className="w-4 h-4" /> Telegram</label>
                  <input type="text" value={form.telegram} onChange={(e) => updateForm("telegram", e.target.value)} placeholder="https://t.me/..."
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50" />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-white/50 text-sm mb-2"><Code className="w-4 h-4" /> GitHub</label>
                  <input type="text" value={form.github} onChange={(e) => updateForm("github", e.target.value)} placeholder="https://github.com/..."
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50" />
                </div>
              </div>

              {/* Creator Statement */}
              <div>
                <label className="block text-white/50 text-sm mb-2">Creator Statement</label>
                <textarea
                  value={form.creatorStatement}
                  onChange={(e) => updateForm("creatorStatement", e.target.value.slice(0, 300))}
                  placeholder="Why are you creating this token? What's your vision?"
                  rows={3}
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 resize-none"
                />
                <p className="text-white/20 text-xs mt-1">{form.creatorStatement.length}/300 — This is permanently attached to your token.</p>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="flex-1 py-3 bg-white/5 text-white/50 font-medium rounded-xl hover:bg-white/10 transition-colors">Back</button>
                <button onClick={() => setStep(4)} className="flex-1 py-3 bg-cyan-500 text-black font-medium rounded-xl hover:bg-cyan-400 transition-colors">Review</button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 4: Review ──────────────────────────────────── */}
          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5 max-w-lg mx-auto">
              {/* Token preview card */}
              <div className="p-6 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border border-white/10">
                <div className="flex items-center gap-4 mb-4">
                  {form.logoPreview ? (
                    <img src={form.logoPreview} alt="Logo" className="w-14 h-14 rounded-xl object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center text-white/30 text-xl font-bold">
                      {form.symbol.slice(0, 2) || "?"}
                    </div>
                  )}
                  <div>
                    <h3 className="text-xl font-medium text-white">{form.name || "Unnamed Token"}</h3>
                    <p className="text-cyan-400 font-mono text-sm">{form.symbol || "???"}</p>
                  </div>
                </div>
                {form.description && <p className="text-white/50 text-sm mb-3">{form.description}</p>}
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 rounded-full bg-white/10 text-white/50">{form.category}</span>
                  <span className="px-2 py-1 rounded-full bg-white/10 text-white/50">{form.decimals} decimals</span>
                  {parseInt(form.initialSupply) > 0 && (
                    <span className="px-2 py-1 rounded-full bg-white/10 text-white/50">
                      {parseInt(form.initialSupply).toLocaleString()} supply
                    </span>
                  )}
                  {parseInt(form.burnRate) > 0 && (
                    <span className="px-2 py-1 rounded-full bg-orange-500/10 text-orange-400">
                      {(parseInt(form.burnRate) / 100).toFixed(2)}% burn
                    </span>
                  )}
                  {parseInt(form.echoRate) > 0 && (
                    <span className="px-2 py-1 rounded-full bg-pink-500/10 text-pink-400">
                      {(parseInt(form.echoRate) / 100).toFixed(2)}% echo
                    </span>
                  )}
                </div>
              </div>

              {/* Shlem Risk Assessment Preview */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm text-white/70 font-medium">Shlem Risk Assessment</span>
                </div>
                <div className="space-y-2">
                  {completeness === 100 ? (
                    <div className="flex items-center gap-2 text-green-400 text-sm">
                      <CheckCircle className="w-4 h-4" /> Metadata complete — eligible for Verified tier
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-yellow-400 text-sm">
                        <AlertTriangle className="w-4 h-4" /> Metadata incomplete ({completeness}%)
                      </div>
                      <div className="pl-6 space-y-1">
                        {missing.map((m) => (
                          <p key={m} className="text-white/30 text-xs flex items-center gap-1">
                            <XCircle className="w-3 h-3 text-white/20" /> {m}
                          </p>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Info box */}
              <div className="p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                <div className="flex gap-2">
                  <Info className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-white/40 space-y-1">
                    <p>Creating a token registers it on the Tonkl network with a ZK proof. {parseInt(form.initialSupply) > 0 ? "Initial supply will be minted — this may take 30-60 seconds for proof generation." : "No tokens will be minted yet."}</p>
                    <p>Your metadata and risk assessment are permanently attached and visible to all users.</p>
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep(3)} className="flex-1 py-3 bg-white/5 text-white/50 font-medium rounded-xl hover:bg-white/10 transition-colors" disabled={isCreating}>
                  Back
                </button>
                <button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="flex-1 py-3 bg-cyan-500 disabled:bg-cyan-500/30 text-black disabled:text-white/30 font-medium rounded-xl hover:bg-cyan-400 transition-colors flex items-center justify-center gap-2"
                >
                  {isCreating ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Creating...</>
                  ) : (
                    <><Sparkles className="w-5 h-5" /> Create Token</>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 5: Success ─────────────────────────────────── */}
          {step === 5 && createdToken && (
            <motion.div key="step5" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-lg mx-auto text-center space-y-6">
              <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto border border-green-500/20">
                <CheckCircle className="w-10 h-10 text-green-400" />
              </div>
              <div>
                <h2 className="text-3xl font-light text-white mb-2">Token Created!</h2>
                <p className="text-white/50">
                  {createdToken.symbol} is now registered on the Tonkl network
                </p>
              </div>

              {warning && (
                <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-left">
                  <p className="text-yellow-400 text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {warning}
                  </p>
                </div>
              )}

              <div className="p-6 rounded-2xl bg-white/5 border border-white/10 text-left space-y-3">
                <div className="flex justify-between">
                  <span className="text-white/40 text-sm">Symbol</span>
                  <span className="text-white font-mono">{createdToken.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40 text-sm">Asset ID</span>
                  <span className="text-white font-mono">{createdToken.assetId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40 text-sm">Tier</span>
                  <TierBadge tier={createdToken.tier} />
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40 text-sm">Risk</span>
                  <RiskBadge score={createdToken.riskScore} />
                </div>
                {createdToken.riskDetails.length > 0 && (
                  <div className="pt-2 border-t border-white/10">
                    <p className="text-white/30 text-xs mb-1">Notes:</p>
                    {createdToken.riskDetails.map((d, i) => (
                      <p key={i} className="text-white/20 text-xs">• {d}</p>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={onBack} className="flex-1 py-3 bg-white/5 text-white/50 font-medium rounded-xl hover:bg-white/10 transition-colors">
                  Back to Dashboard
                </button>
                <button
                  onClick={() => {
                    setStep(1);
                    setCreatedToken(null);
                    setForm({
                      symbol: "", name: "", description: "", category: "Utility",
                      logoFile: null, logoPreview: "", decimals: 0, initialSupply: "1000000",
                      supplyCap: "", website: "", twitter: "", discord: "", telegram: "",
                      github: "", creatorStatement: "", burnRate: "0", echoRate: "0", echoRecipient: "",
                    });
                  }}
                  className="flex-1 py-3 bg-cyan-500 text-black font-medium rounded-xl hover:bg-cyan-400 transition-colors"
                >
                  Create Another
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </>}
    </div>
  );
}
