"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Maximize2, Minimize2, Ban, ShieldCheck, Loader2,
  CheckCircle, AlertTriangle, Sparkles, Shield, Pencil,
  ChevronUp, Coins,
} from "lucide-react";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import SiriOrb from "@/components/ui/siri-orb";
import { GooeyFilter } from "@/components/ui/gooey-filter";

// ─── Rich message types ────────────────────────────────────────

type TokenCategory =
  | "Utility" | "Governance" | "Meme" | "Stablecoin"
  | "Impact" | "Community" | "Gaming" | "RWA" | "Other";

type RiskScore = "low" | "medium" | "high" | "critical";

type TokenFormData = {
  symbol: string;
  name: string;
  description: string;
  category: TokenCategory;
  decimals: number;
  initialSupply: string;
  supplyCap: string;
  website: string;
  twitter: string;
  discord: string;
  telegram: string;
  github: string;
  creatorStatement: string;
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

type MessageKind =
  | "text"
  | "blocked"
  | "error"
  | "read"
  | "token_preview"
  | "token_creating"
  | "token_success"
  | "token_error"
  | "preview";

type ShlemModelStatus = "connected" | "fallback" | "disabled" | "skipped_blocked" | "unknown";

type ShlemPreview = {
  preview_id: string;
  action: string;
  title: string;
  summary: string;
  fields: Record<string, string | number | boolean | null>;
  warnings: string[];
  confirmation_text: string;
  can_execute: boolean;
};

type ChatMessage = {
  id: string;
  text: string;
  isUser: boolean;
  kind?: MessageKind;
  preview?: ShlemPreview | null;
  executionEnabled?: boolean;
  modelStatus?: ShlemModelStatus;
  modelName?: string | null;
  tokenForm?: Partial<TokenFormData>;
  createdToken?: CreatedToken;
  warning?: string;
  extractedFields?: Partial<TokenFormData>;
};

type ShlemApiResponse = {
  reply?: string;
  kind?: string;
  preview?: ShlemPreview | null;
  executionEnabled?: boolean;
  modelStatus?: ShlemModelStatus;
  modelName?: string | null;
  payload?: {
    intent?: string;
    model?: { ok?: boolean; text?: string; status?: string; name?: string };
    message?: string;
    execution?: {
      ok?: boolean;
      data?: {
        extracted_fields?: Partial<TokenFormData>;
        [key: string]: unknown;
      };
    };
  };
};

// ─── Constants ─────────────────────────────────────────────────

const CATEGORIES: TokenCategory[] = [
  "Utility", "Governance", "Meme", "Stablecoin",
  "Impact", "Community", "Gaming", "RWA", "Other",
];

const DEFAULT_FORM: TokenFormData = {
  symbol: "", name: "", description: "", category: "Utility",
  decimals: 0, initialSupply: "1000000", supplyCap: "",
  website: "", twitter: "", discord: "", telegram: "",
  github: "", creatorStatement: "", burnRate: "0",
  echoRate: "0", echoRecipient: "",
};

// ─── Component ─────────────────────────────────────────────────

interface ShlemChatOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShlemChatOverlay({ isOpen, onClose }: ShlemChatOverlayProps) {
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isShlemSpeaking, setIsShlemSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cancelledPreviewIds, setCancelledPreviewIds] = useState<Set<string>>(() => new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [tokenForm, setTokenForm] = useState<TokenFormData>({ ...DEFAULT_FORM });
  const [isCreatingToken, setIsCreatingToken] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      text: "I am Shlem, your encrypted assistant for the Tonkl network. I can check balances, prepare sends, create tokens, scan notes, and more. Just tell me what you need.",
      isUser: false,
    },
  ]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let t1: NodeJS.Timeout;
    let t2: NodeJS.Timeout;
    if (isVoiceMode) {
      t1 = setTimeout(() => setIsShlemSpeaking(true), 2000);
      t2 = setTimeout(() => setIsShlemSpeaking(false), 6000);
    }
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isVoiceMode]);

  // Detect when the user is explicitly leaving token creation
  const isExitingTokenContext = (text: string) => {
    const lower = text.toLowerCase();
    const exitPatterns = [
      /\b(?:changed?\s+my\s+mind|never\s*mind|forget\s+(?:it|the\s+token|about)|cancel|stop\s+(?:creating|the\s+token)|don'?t\s+want\s+(?:to\s+create|the\s+token)|skip\s+(?:it|the\s+token|that))\b/,
      /\b(?:instead|actually)\b.*\b(?:want\s+to|let'?s|can\s+(?:you|i|we))\b/,
      /\bi\s+(?:want\s+to|wanna|need\s+to)\s+(?:stake|send|receive|transfer|check|see|view|swap)\b/,
    ];
    return exitPatterns.some((p) => p.test(lower));
  };

  const isTokenContext = (currentMessage?: string) => {
    // If the user is clearly exiting, reset and return false
    if (currentMessage && isExitingTokenContext(currentMessage)) {
      setTokenForm({ ...DEFAULT_FORM });
      return false;
    }
    const recent = messages.slice(-6);
    return recent.some(
      (m) =>
        m.kind === "token_preview" ||
        m.kind === "token_creating" ||
        m.kind === "token_success" ||
        m.extractedFields ||
        (tokenForm.symbol !== "" && tokenForm.name !== "")
    );
  };

  const applyExtractedFields = (fields: Partial<TokenFormData>) => {
    setTokenForm((prev) => ({ ...prev, ...fields }));
  };

  // ── Create token ─────────────────────────────────────────
  const handleCreateToken = async (form: TokenFormData) => {
    setIsCreatingToken(true);
    const creatingId = createMessageId();
    setMessages((prev) => [
      ...prev,
      {
        id: creatingId,
        text: `Creating ${form.symbol} on the Tonkl network. Generating ZK proof — this may take 30-60 seconds...`,
        isUser: false,
        kind: "token_creating",
      },
    ]);

    try {
      const resp = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          symbol: form.symbol.toUpperCase(),
          name: form.name,
          decimals: form.decimals,
          initialSupply: parseInt(form.initialSupply) || 0,
          description: form.description,
          category: form.category,
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
      setMessages((prev) => prev.filter((m) => m.id !== creatingId));

      if (!resp.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            text: data.message || "Token creation failed. Make sure the node is running.",
            isUser: false,
            kind: "token_error",
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          text: `${form.symbol} has been created on the Tonkl network.`,
          isUser: false,
          kind: "token_success",
          createdToken: data.token,
          warning: data.warning,
        },
      ]);
      setTokenForm({ ...DEFAULT_FORM });
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== creatingId));
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          text: "Network error. Check that the node is running.",
          isUser: false,
          kind: "token_error",
        },
      ]);
    } finally {
      setIsCreatingToken(false);
    }
  };

  // ── Main send handler ────────────────────────────────────
  const handleSend = async (text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText || isLoading) return;

    const history = messages
      .filter((m) => m.id !== "welcome" && m.kind !== "token_creating")
      .slice(-12)
      .map((m) => ({ role: m.isUser ? "user" : "assistant", content: m.text }));

    setMessages((prev) => [
      ...prev,
      { id: createMessageId(), text: trimmedText, isUser: true },
    ]);
    setIsLoading(true);

    try {
      const context = isTokenContext(trimmedText) ? "token_creation" : undefined;
      const response = await fetch("/api/shlem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedText,
          history,
          context,
          currentForm: context === "token_creation" ? tokenForm : undefined,
        }),
      });

      const data = (await response.json().catch(() => null)) as ShlemApiResponse | null;
      const reply = data?.reply || "I could not read the Shlem response.";

      const extracted = data?.payload?.execution?.data?.extracted_fields;
      if (extracted && Object.keys(extracted).length > 0) {
        applyExtractedFields(extracted);
      }

      const updatedForm = extracted ? { ...tokenForm, ...extracted } : tokenForm;
      const hasEnoughForPreview = updatedForm.symbol && updatedForm.name && updatedForm.initialSupply;
      const isTokenIntent =
        data?.payload?.intent === "create_token" ||
        data?.payload?.intent === "update_token_creation" ||
        (context === "token_creation" && extracted && Object.keys(extracted).length > 0);

      if (isTokenIntent && hasEnoughForPreview) {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            text: reply,
            isUser: false,
            kind: "token_preview",
            tokenForm: updatedForm,
            extractedFields: extracted || undefined,
            modelStatus: data?.modelStatus || "unknown",
            modelName: data?.modelName || null,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            text: reply,
            isUser: false,
            kind: (data?.kind as MessageKind) || (response.ok ? "text" : "error"),
            preview: data?.preview || null,
            executionEnabled: Boolean(data?.executionEnabled),
            modelStatus: data?.modelStatus || "unknown",
            modelName: data?.modelName || null,
            extractedFields: extracted && Object.keys(extracted).length > 0 ? extracted : undefined,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          text: "I could not reach the local Shlem route. Check that the Next dev server is running.",
          isUser: false,
          kind: "error",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelPreview = (previewId: string) => {
    if (cancelledPreviewIds.has(previewId)) return;
    setCancelledPreviewIds((prev) => {
      const next = new Set(prev);
      next.add(previewId);
      return next;
    });
    setMessages((prev) => [
      ...prev,
      { id: createMessageId(), text: `Preview ${previewId} cancelled.`, isUser: false, kind: "text" },
    ]);
  };

  // ─── RENDER ──────────────────────────────────────────────

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {isFullscreen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-y-0 right-0 left-20 z-[40] bg-[#020202] overflow-hidden"
              onClick={onClose}
            >
              <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-cyan-500/30 via-transparent to-transparent pointer-events-none" />
            </motion.div>
          )}

          <motion.div
            initial={isFullscreen ? { opacity: 0, scale: 0.95, y: 20 } : { opacity: 0, y: 20, scale: 0.9 }}
            animate={isFullscreen ? { opacity: 1, scale: 1, y: 0 } : { opacity: 1, y: 0, scale: 1 }}
            exit={isFullscreen ? { opacity: 0, scale: 0.95, y: 20 } : { opacity: 0, y: 20, scale: 0.9 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={`fixed z-[50] flex flex-col overflow-hidden transition-all duration-500 ease-in-out ${
              isFullscreen
                ? "inset-y-4 right-4 left-24 md:inset-y-12 md:right-12 md:left-[8.5rem] lg:inset-y-12 lg:right-32 lg:left-52 bg-transparent"
                : "bottom-6 right-6 w-[380px] h-[600px] bg-[#0a0a0a]/95 backdrop-blur-2xl rounded-2xl border border-cyan-500/20 shadow-[0_0_40px_rgba(34,211,238,0.15)]"
            }`}
          >
            {/* Header */}
            <div className={`flex items-center justify-end p-4 ${!isFullscreen && "border-b border-white/10"}`}>
              <div className="flex items-center gap-2">
                <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 rounded-lg transition-colors">
                  {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button onClick={onClose} className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
                  <X className={isFullscreen ? "w-6 h-6" : "w-5 h-5"} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <GooeyFilter id="chat-gooey-filter" strength={3} />
            <AnimatePresence mode="wait">
              {!isVoiceMode ? (
                <motion.div
                  key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className={`flex-1 overflow-y-auto p-4 space-y-4 ${isFullscreen ? "px-12" : "px-4"}`}
                  style={{ filter: "url(#chat-gooey-filter)" }}
                >
                  {messages.map((msg) => (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      key={msg.id}
                      className={`flex ${msg.isUser ? "justify-end" : "justify-start"}`}
                    >
                      {msg.isUser ? (
                        <div className="max-w-[80%] rounded-[24px] rounded-br-sm px-5 py-3.5 bg-[#111111] text-white/95 border border-white/5 shadow-md">
                          <p className={`${isFullscreen ? "text-lg" : "text-sm"} whitespace-pre-wrap`}>{msg.text}</p>
                        </div>
                      ) : msg.kind === "token_preview" ? (
                        <TokenPreviewCard
                          msg={msg}
                          isFullscreen={isFullscreen}
                          isCreating={isCreatingToken}
                          onConfirm={() => handleCreateToken({ ...tokenForm, ...(msg.tokenForm || {}) } as TokenFormData)}
                          onEdit={(field, value) => setTokenForm((prev) => ({ ...prev, [field]: value }))}
                        />
                      ) : msg.kind === "token_creating" ? (
                        <div className="max-w-[80%] rounded-2xl rounded-bl-none p-4 bg-cyan-500/5 border border-cyan-500/20 shadow-lg">
                          <div className="flex items-center gap-3 mb-2">
                            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                            <span className={`${isFullscreen ? "text-lg" : "text-sm"} text-cyan-400 font-medium`}>Creating token...</span>
                          </div>
                          <p className={`${isFullscreen ? "text-base" : "text-sm"} text-white/60`}>{msg.text}</p>
                          <div className="mt-3 h-1 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full animate-pulse" style={{ width: "60%" }} />
                          </div>
                        </div>
                      ) : msg.kind === "token_success" ? (
                        <TokenSuccessCard msg={msg} isFullscreen={isFullscreen} />
                      ) : msg.kind === "token_error" ? (
                        <div className="max-w-[80%] rounded-2xl rounded-bl-none p-4 bg-red-500/10 border border-red-500/20 shadow-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-4 h-4 text-red-400" />
                            <span className={`${isFullscreen ? "text-lg" : "text-sm"} text-red-400 font-medium`}>Token Creation Failed</span>
                          </div>
                          <p className={`${isFullscreen ? "text-base" : "text-sm"} text-white/70`}>{msg.text}</p>
                        </div>
                      ) : (
                        <div className={`max-w-[80%] rounded-[24px] px-5 py-3.5 ${assistantBubbleClass(msg.kind)}`}>
                          <p className={`${isFullscreen ? "text-lg" : "text-sm"} whitespace-pre-wrap`}>{msg.text}</p>
                          {msg.extractedFields && Object.keys(msg.extractedFields).length > 0 && (
                            <ExtractedFieldsBadge fields={msg.extractedFields} />
                          )}
                          {msg.preview && (
                            <GenericPreviewCard
                              preview={msg.preview}
                              executionEnabled={Boolean(msg.executionEnabled)}
                              isCancelled={cancelledPreviewIds.has(msg.preview.preview_id)}
                              onCancel={() => handleCancelPreview(msg.preview!.preview_id)}
                            />
                          )}
                          {!msg.isUser && msg.modelStatus && (
                            <p className="mt-2 text-[10px] uppercase tracking-wide text-cyan-100/35">
                              {formatModelStatus(msg.modelStatus, msg.modelName)}
                            </p>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))}
                  {isLoading && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
                      <div className="max-w-[80%] rounded-[24px] rounded-bl-sm px-5 py-3.5 bg-white/90 backdrop-blur-xl text-black border border-white/20 shadow-md">
                        <p className={`${isFullscreen ? "text-lg" : "text-sm"} animate-pulse`}>Shlem is thinking...</p>
                      </div>
                    </motion.div>
                  )}
                  <div ref={chatEndRef} />
                </motion.div>
              ) : (
                <motion.div
                  key="voice" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                  className="flex-1 flex flex-col items-center justify-center p-4 relative"
                >
                  <SiriOrb isSpeaking={isShlemSpeaking} size={isFullscreen ? "400px" : "250px"} />
                  <p className="mt-8 text-cyan-400/70 font-mono text-sm animate-pulse">
                    {isShlemSpeaking ? "Shlem AI is speaking..." : "Listening to your voice..."}
                  </p>
                  <button
                    onClick={() => { setIsVoiceMode(false); setIsShlemSpeaking(false); }}
                    className="mt-8 px-6 py-2 rounded-full border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    End Voice Mode
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Prompt Box */}
            <AnimatePresence>
              {!isVoiceMode && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
                  className={`p-4 ${isFullscreen ? "px-12 pb-8 max-w-4xl mx-auto w-full" : "pt-2"}`}
                >
                  <PromptInputBox
                    onSend={(msg) => handleSend(msg)}
                    onVoiceModeToggle={(active) => { setIsVoiceMode(active); if (!active) setIsShlemSpeaking(false); }}
                    isLoading={isLoading}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Token Preview Card ────────────────────────────────────────

function TokenPreviewCard({
  msg, isFullscreen, isCreating, onConfirm, onEdit,
}: {
  msg: ChatMessage;
  isFullscreen: boolean;
  isCreating: boolean;
  onConfirm: () => void;
  onEdit: (field: string, value: string | number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const form = msg.tokenForm || {};
  const { score, missing } = getCompleteness(form);

  return (
    <div className="max-w-[85%] rounded-2xl rounded-bl-none overflow-hidden border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-purple-500/5 shadow-lg">
      <div className="p-4 pb-0">
        <p className={`${isFullscreen ? "text-base" : "text-sm"} text-white/80 whitespace-pre-wrap`}>{msg.text}</p>
      </div>

      <div className="p-4">
        {/* Token header */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center">
            <Coins className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-white">{form.name || "Unnamed Token"}</h3>
            <p className="text-cyan-400 font-mono text-sm">{form.symbol || "???"}</p>
          </div>
          <div className="ml-auto">
            <div className="relative w-10 h-10">
              <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#333" strokeWidth="2" />
                <circle cx="18" cy="18" r="15.9" fill="none"
                  stroke={score === 100 ? "#22d3ee" : score >= 50 ? "#eab308" : "#ef4444"}
                  strokeWidth="2" strokeDasharray={`${score} ${100 - score}`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/60 font-medium">{score}%</span>
            </div>
          </div>
        </div>

        {/* Key fields */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {form.category && <FieldChip label="Category" value={form.category as string} />}
          {form.initialSupply && parseInt(form.initialSupply as string) > 0 && (
            <FieldChip label="Supply" value={parseInt(form.initialSupply as string).toLocaleString()} />
          )}
          <FieldChip label="Decimals" value={String(form.decimals ?? 0)} />
          {form.burnRate && parseInt(form.burnRate as string) > 0 && (
            <FieldChip label="Burn" value={`${(parseInt(form.burnRate as string) / 100).toFixed(2)}%`} />
          )}
        </div>

        {form.description && <p className="text-white/40 text-xs mb-3">{form.description as string}</p>}

        {missing.length > 0 && (
          <div className="mb-3 p-2 rounded-lg bg-yellow-500/5 border border-yellow-500/15">
            <p className="text-yellow-400/70 text-xs">Optional: {missing.join(", ")}</p>
          </div>
        )}

        {/* Edit toggle */}
        <button onClick={() => setIsEditing(!isEditing)} className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors mb-3">
          {isEditing ? <ChevronUp className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
          {isEditing ? "Close editor" : "Edit details"}
        </button>

        <AnimatePresence>
          {isEditing && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <TokenInlineEditor form={form} onEdit={onEdit} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Risk assessment */}
        <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 mb-3">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] text-white/50 font-medium uppercase tracking-wider">Risk Assessment</span>
          </div>
          {score === 100 ? (
            <p className="text-green-400 text-xs flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Metadata complete — eligible for Verified tier
            </p>
          ) : (
            <p className="text-yellow-400 text-xs flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Metadata {score}% — Standard tier
            </p>
          )}
        </div>

        <p className="text-white/25 text-[11px] mb-4">
          {parseInt(form.initialSupply as string) > 0
            ? "This will generate a ZK proof to register and mint. May take 30-60 seconds."
            : "This will register the token on-chain. No tokens minted yet."}
        </p>

        {/* Create button */}
        <button
          onClick={onConfirm}
          disabled={isCreating || !form.symbol || !form.name}
          className="w-full py-2.5 bg-cyan-500 disabled:bg-white/10 text-black disabled:text-white/30 font-medium rounded-xl hover:bg-cyan-400 transition-colors flex items-center justify-center gap-2 text-sm"
        >
          {isCreating ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Create Token</>
          )}
        </button>
      </div>

      {msg.modelStatus && (
        <div className="px-4 pb-2">
          <p className="text-[10px] uppercase tracking-wide text-cyan-100/35">{formatModelStatus(msg.modelStatus, msg.modelName)}</p>
        </div>
      )}
    </div>
  );
}

// ─── Token Inline Editor ───────────────────────────────────────

function TokenInlineEditor({ form, onEdit }: { form: Partial<TokenFormData>; onEdit: (field: string, value: string | number) => void }) {
  return (
    <div className="space-y-3 mb-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
      <div className="grid grid-cols-2 gap-2">
        <EditField label="Symbol" value={form.symbol as string || ""} onChange={(v) => onEdit("symbol", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} />
        <EditField label="Name" value={form.name as string || ""} onChange={(v) => onEdit("name", v.slice(0, 64))} />
      </div>
      <EditField label="Description" value={form.description as string || ""} onChange={(v) => onEdit("description", v.slice(0, 500))} multiline />
      <div className="grid grid-cols-2 gap-2">
        <EditField label="Supply" value={form.initialSupply as string || "0"} onChange={(v) => onEdit("initialSupply", v.replace(/[^0-9]/g, ""))} />
        <div>
          <label className="block text-white/30 text-[10px] uppercase tracking-wider mb-1">Category</label>
          <select value={form.category as string || "Utility"} onChange={(e) => onEdit("category", e.target.value)}
            className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500/50">
            {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <EditField label="Decimals" value={String(form.decimals ?? 0)} onChange={(v) => onEdit("decimals", parseInt(v) || 0)} />
        <EditField label="Burn (bps)" value={form.burnRate as string || "0"} onChange={(v) => onEdit("burnRate", v.replace(/[^0-9]/g, ""))} />
        <EditField label="Echo (bps)" value={form.echoRate as string || "0"} onChange={(v) => onEdit("echoRate", v.replace(/[^0-9]/g, ""))} />
      </div>
      <EditField label="Website" value={form.website as string || ""} onChange={(v) => onEdit("website", v)} />
      <EditField label="Creator Statement" value={form.creatorStatement as string || ""} onChange={(v) => onEdit("creatorStatement", v.slice(0, 300))} multiline />
    </div>
  );
}

function EditField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div>
      <label className="block text-white/30 text-[10px] uppercase tracking-wider mb-1">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2}
          className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500/50 resize-none" />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500/50" />
      )}
    </div>
  );
}

// ─── Token Success Card ────────────────────────────────────────

function TokenSuccessCard({ msg, isFullscreen }: { msg: ChatMessage; isFullscreen: boolean }) {
  const token = msg.createdToken;
  if (!token) return null;

  return (
    <div className="max-w-[85%] rounded-2xl rounded-bl-none overflow-hidden border border-green-500/20 bg-gradient-to-br from-green-500/5 to-cyan-500/5 shadow-lg">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
            <CheckCircle className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h3 className={`${isFullscreen ? "text-xl" : "text-lg"} font-medium text-white`}>Token Created</h3>
            <p className="text-green-400 text-sm">{token.symbol} is live on the Tonkl network</p>
          </div>
        </div>

        {msg.warning && (
          <div className="mb-3 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <p className="text-yellow-400 text-xs flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {msg.warning}
            </p>
          </div>
        )}

        <div className="space-y-2 mb-3">
          <TokenDetailRow label="Symbol" value={token.symbol} mono />
          <TokenDetailRow label="Asset ID" value={token.assetId} mono />
          <TokenDetailRow label="Tier"><TierBadge tier={token.tier} /></TokenDetailRow>
          <TokenDetailRow label="Risk" last><RiskBadge score={token.riskScore} /></TokenDetailRow>
        </div>

        {token.riskDetails.length > 0 && (
          <div className="p-2 rounded-lg bg-white/[0.02] border border-white/5">
            <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">Notes</p>
            {token.riskDetails.map((d, i) => <p key={i} className="text-white/20 text-xs">{d}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}

function TokenDetailRow({ label, value, mono, last, children }: { label: string; value?: string; mono?: boolean; last?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`flex justify-between py-1.5 ${!last ? "border-b border-white/5" : ""}`}>
      <span className="text-white/40 text-xs">{label}</span>
      {children || <span className={`text-white text-xs ${mono ? "font-mono" : ""}`}>{value}</span>}
    </div>
  );
}

// ─── Extracted Fields Badge ────────────────────────────────────

function ExtractedFieldsBadge({ fields }: { fields: Partial<TokenFormData> }) {
  return (
    <div className="mt-3 p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
      <p className="text-[10px] text-purple-400 font-medium uppercase tracking-wider mb-1.5">Extracted fields</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(fields).map(([key, val]) => (
          <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/15 text-xs text-white/60">
            <span className="text-purple-400/70 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}:</span>
            <span className="text-white/80 font-mono">{String(val)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Generic Preview Card ──────────────────────────────────────

function GenericPreviewCard({ preview, executionEnabled, isCancelled, onCancel }: {
  preview: ShlemPreview; executionEnabled: boolean; isCancelled: boolean; onCancel: () => void;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-cyan-300/20 bg-black/35">
      <div className="flex items-start gap-3 border-b border-cyan-300/10 p-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-300/25 bg-cyan-300/10">
          <ShieldCheck className="h-4 w-4 text-cyan-300" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{preview.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-cyan-50/75">{preview.summary}</p>
        </div>
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        {Object.entries(preview.fields).map(([key, value]) => (
          <div key={key} className="min-w-0 rounded-md border border-white/10 bg-white/[0.03] p-2">
            <p className="text-[10px] uppercase tracking-wide text-cyan-200/50">{key.replaceAll("_", " ")}</p>
            <p className="mt-1 break-words text-xs text-white">{String(value ?? "")}</p>
          </div>
        ))}
      </div>
      {preview.warnings.length > 0 && (
        <div className="space-y-2 border-t border-cyan-300/10 p-3">
          {preview.warnings.map((w) => (
            <div key={w} className="flex gap-2 text-xs leading-relaxed text-cyan-50/70">
              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" /><span>{w}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-cyan-300/10 p-3 sm:flex-row sm:items-center sm:justify-end">
        <button type="button" onClick={onCancel} disabled={isCancelled}
          className="h-9 rounded-md border border-white/10 px-3 text-xs font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/35">
          {isCancelled ? "Cancelled" : "Cancel"}
        </button>
        <button type="button" disabled
          className="h-9 rounded-md border border-cyan-300/15 bg-cyan-300/10 px-3 text-xs font-medium text-cyan-100/45"
          title={executionEnabled ? "Live execution is not connected in this beta route." : "This preview cannot execute."}>
          Confirm locked
        </button>
      </div>
    </div>
  );
}

// ─── Utility ───────────────────────────────────────────────────

function FieldChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5">
      <p className="text-[9px] text-white/30 uppercase tracking-wider">{label}</p>
      <p className="text-xs text-white/70 font-mono">{value}</p>
    </div>
  );
}

function RiskBadge({ score }: { score: RiskScore }) {
  const c = { low: "green", medium: "yellow", high: "orange", critical: "red" }[score];
  const label = { low: "Low Risk", medium: "Medium Risk", high: "High Risk", critical: "Critical Risk" }[score];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-${c}-400 bg-${c}-500/10 border border-${c}-500/30`}>
      <Shield className="w-2.5 h-2.5" /> {label}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  if (tier === "verified") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/30">
      <CheckCircle className="w-2.5 h-2.5" /> Verified
    </span>
  );
  if (tier === "unverified") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-red-400 bg-red-500/10 border border-red-500/30">
      <AlertTriangle className="w-2.5 h-2.5" /> Unverified
    </span>
  );
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-white/60 bg-white/5 border border-white/10">Standard</span>;
}

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function assistantBubbleClass(kind?: MessageKind) {
  if (kind === "blocked") return "bg-red-500/10 text-red-50 border border-red-500/25 shadow-[0_0_15px_rgba(239,68,68,0.12)] rounded-bl-sm";
  if (kind === "error") return "bg-amber-500/10 text-amber-50 border border-amber-500/25 shadow-[0_0_15px_rgba(245,158,11,0.12)] rounded-bl-sm";
  return "bg-white/90 backdrop-blur-xl text-black shadow-md border border-white/20 rounded-bl-sm";
}

function formatModelStatus(status: ShlemModelStatus, modelName?: string | null) {
  if (status === "connected") return modelName ? `${modelName}` : "Model connected";
  if (status === "fallback") return "Fallback mode";
  if (status === "disabled") return "Model disabled";
  if (status === "skipped_blocked") return "Blocked";
  return "";
}

function getCompleteness(form: Partial<TokenFormData>): { score: number; missing: string[] } {
  const missing: string[] = [];
  if (!form.symbol) missing.push("Symbol");
  if (!form.name) missing.push("Name");
  if (!form.description || String(form.description).length < 20) missing.push("Description");
  if (!form.website) missing.push("Website");
  if (!form.twitter && !form.discord && !form.telegram) missing.push("Social link");
  if (!form.creatorStatement || String(form.creatorStatement).length < 10) missing.push("Creator statement");
  const total = 6;
  return { score: Math.round(((total - missing.length) / total) * 100), missing };
}
