"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Maximize2, Minimize2, Ban, ShieldCheck, Loader2,
  CheckCircle, AlertTriangle, Sparkles, Shield, Pencil,
  ChevronUp, ImagePlus,
} from "lucide-react";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import SiriOrb from "@/components/ui/siri-orb";
import { GooeyFilter } from "@/components/ui/gooey-filter";
import { tonklSessionHeaders } from "@/lib/client-session";
import { maskSecretText } from "@/lib/secret-mask";

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
  _askedAdvanced?: boolean;
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

type TonklAIModelStatus = "connected" | "fallback" | "disabled" | "skipped_blocked" | "unknown";

type TonklAIPreview = {
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
  preview?: TonklAIPreview | null;
  executionEnabled?: boolean;
  modelStatus?: TonklAIModelStatus;
  modelName?: string | null;
  tokenForm?: Partial<TokenFormData>;
  createdToken?: CreatedToken;
  warning?: string;
  extractedFields?: Partial<TokenFormData>;
};

type TonklAIApiResponse = {
  reply?: string;
  kind?: string;
  preview?: TonklAIPreview | null;
  executionEnabled?: boolean;
  modelStatus?: TonklAIModelStatus;
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
  decimals: 0, initialSupply: "", supplyCap: "",
  website: "", twitter: "", discord: "", telegram: "",
  github: "", creatorStatement: "", burnRate: "0",
  echoRate: "0", echoRecipient: "",
};

// ─── Component ─────────────────────────────────────────────────

interface TonklAIChatOverlayProps {
  isOpen?: boolean;
  onClose?: () => void;
  embedded?: boolean;
}

export function TonklAIChatOverlay({ isOpen, onClose, embedded = false }: TonklAIChatOverlayProps) {
  const [isFullscreen, setIsFullscreen] = useState(embedded ? true : true);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isTonklAISpeaking, setIsTonklAISpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cancelledPreviewIds, setCancelledPreviewIds] = useState<Set<string>>(() => new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [tokenForm, setTokenForm] = useState<TokenFormData>({ ...DEFAULT_FORM });
  const [isCreatingToken, setIsCreatingToken] = useState(false);
  const [tokenFlowActive, setTokenFlowActive] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      text: "I am Tonkl AI, your encrypted assistant for the Tonkl network. I can check balances, prepare sends, create tokens, scan notes, and more. Just tell me what you need.",
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
      t1 = setTimeout(() => setIsTonklAISpeaking(true), 2000);
      t2 = setTimeout(() => setIsTonklAISpeaking(false), 6000);
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
      setTokenFlowActive(false);
      return false;
    }

    // If the guided flow is already active, stay in token context
    if (tokenFlowActive) return true;

    // Detect initial token creation intent from the current message
    if (currentMessage) {
      const lower = currentMessage.toLowerCase();
      const intentPatterns = [
        /\b(?:create|make|mint|launch|deploy|start|build|set\s*up)\s+(?:a\s+)?(?:new\s+)?token\b/,
        /\b(?:i\s+want|i(?:'d|\s+would)\s+like|let(?:'s|\s+us)|can\s+(?:i|we|you))\s+(?:create|make|mint|launch|deploy)\s+(?:a\s+)?token\b/,
        /\btoken\s+creation\b/,
        /\bnew\s+token\b/,
        /\bcreate\s+(?:a\s+)?coin\b/,
      ];
      if (intentPatterns.some((p) => p.test(lower))) {
        setTokenFlowActive(true);
        return true;
      }
    }

    // Existing checks: recent messages contain token-related activity
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
        headers: { "Content-Type": "application/json", ...tonklSessionHeaders() },
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
      setTokenFlowActive(false);
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
    const visibleText = maskSecretText(trimmedText).text;

    const history = messages
      .filter((m) => m.id !== "welcome" && m.kind !== "token_creating")
      .slice(-12)
      .map((m) => ({ role: m.isUser ? "user" : "assistant", content: m.text }));

    setMessages((prev) => [
      ...prev,
      { id: createMessageId(), text: visibleText, isUser: true },
    ]);
    setIsLoading(true);

    try {
      const context = isTokenContext(trimmedText) ? "token_creation" : undefined;
      const response = await fetch("/api/tonkl-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tonklSessionHeaders() },
        body: JSON.stringify({
          message: trimmedText,
          history,
          context,
          currentForm: context === "token_creation" ? tokenForm : undefined,
        }),
      });

      const data = (await response.json().catch(() => null)) as TonklAIApiResponse | null;
      const reply = maskSecretText(data?.reply || "I could not read the Tonkl AI response.").text;

      const extracted = data?.payload?.execution?.data?.extracted_fields;
      if (extracted && Object.keys(extracted).length > 0) {
        applyExtractedFields(extracted);
      }

      const updatedForm = extracted ? { ...tokenForm, ...extracted } : tokenForm;
      // Only show the preview card when the guided flow has finished all steps
      // and the API reply contains the summary with the "Create Token" prompt
      const isReadyForPreview = reply.includes("Create Token") && (reply.includes("preview") || reply.includes("summary"));
      const isTokenIntent =
        data?.payload?.intent === "create_token" ||
        data?.payload?.intent === "update_token_creation" ||
        (context === "token_creation" && extracted && Object.keys(extracted).length > 0);

      // Activate the guided token flow when the API confirms token creation intent
      if (data?.payload?.intent === "create_token" || data?.payload?.intent === "update_token_creation") {
        setTokenFlowActive(true);
      }

      if (isTokenIntent && isReadyForPreview) {
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
            // Suppress the generic preview card during the guided token creation flow
            // — the user only needs the DexScreener-style card at the end
            preview: (context === "token_creation" ? null : data?.preview) || null,
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
          text: "I could not reach the local Tonkl AI route. Check that the Next dev server is running.",
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

  const chatContent = (
    <>
            {/* Header */}
            {!embedded && (
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
            )}

            {/* Messages */}
            <GooeyFilter id="chat-gooey-filter" strength={3} />
            <AnimatePresence mode="wait">
              {!isVoiceMode ? (
                <motion.div
                  key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className={`flex-1 overflow-y-auto p-4 space-y-4 ${isFullscreen ? "px-12" : "px-4"}`}
                >
                  {messages.map((msg) => (
                    <motion.div
                      initial={{ opacity: 0, y: 15, scale: 0.85 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 22, mass: 1.2 }}
                      key={msg.id}
                      className={`flex ${msg.isUser ? "justify-end" : "justify-start"}`}
                      style={{ transformOrigin: msg.isUser ? "bottom right" : "bottom left" }}
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
                        <p className={`${isFullscreen ? "text-lg" : "text-sm"} animate-pulse`}>Tonkl AI is thinking...</p>
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
                  <SiriOrb isSpeaking={isTonklAISpeaking} size={isFullscreen ? "400px" : "250px"} />
                  <p className="mt-8 text-cyan-400/70 font-mono text-sm animate-pulse">
                    {isTonklAISpeaking ? "Tonkl AI is speaking..." : "Listening to your voice..."}
                  </p>
                  <button
                    onClick={() => { setIsVoiceMode(false); setIsTonklAISpeaking(false); }}
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
                    onVoiceModeToggle={(active) => { setIsVoiceMode(active); if (!active) setIsTonklAISpeaking(false); }}
                    isLoading={isLoading}
                  />
                </motion.div>
              )}
            </AnimatePresence>
    </>
  );

  if (embedded) {
    return (
      <div className="w-full h-full flex flex-col">
        {chatContent}
      </div>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {isFullscreen && (
            <motion.div
              initial={{ opacity: 1, y: "100vh" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 1, y: "100vh" }}
              transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
              className="fixed inset-y-0 right-0 left-20 z-[40] bg-[#020202] overflow-hidden"
              onClick={onClose}
            >
              <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-cyan-500/30 via-transparent to-transparent pointer-events-none" />
            </motion.div>
          )}

          <motion.div
            initial={isFullscreen ? { opacity: 1, y: "100vh" } : { opacity: 0, y: 20, scale: 0.9 }}
            animate={isFullscreen ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, scale: 1 }}
            exit={isFullscreen ? { opacity: 1, y: "100vh" } : { opacity: 0, y: 20, scale: 0.9 }}
            transition={isFullscreen ? { duration: 0.6, ease: [0.32, 0.72, 0, 1] } : { duration: 0.3, ease: "easeOut" }}
            className={`fixed z-[50] flex flex-col overflow-hidden transition-all duration-500 ease-in-out ${
              isFullscreen
                ? "inset-y-4 right-4 left-24 md:inset-y-12 md:right-12 md:left-[8.5rem] lg:inset-y-12 lg:right-32 lg:left-52 bg-transparent"
                : "bottom-6 right-6 w-[380px] h-[600px] bg-[#0a0a0a]/95 backdrop-blur-2xl rounded-2xl border border-cyan-500/20 shadow-[0_0_40px_rgba(34,211,238,0.15)]"
            }`}
          >
            {chatContent}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Token Preview Card ────────────────────────────────────────

function generateTokenColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function generateChartHeights(seedText: string): number[] {
  let seed = 0;
  for (let i = 0; i < seedText.length; i++) {
    seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  }

  return Array.from({ length: 30 }, (_, i) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed % 1000) / 1000;
    const trend = (i / 30) * 15;
    return Math.max(8, Math.min(42, 12 + Math.sin(i * 0.5) * 6 + noise * 8 + trend));
  });
}

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
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const form = msg.tokenForm || {};
  const { score, missing } = getCompleteness(form);
  const symbol = (form.symbol as string || "???").toUpperCase();
  const name = (form.name as string) || "Unnamed Token";
  const supply = form.initialSupply ? parseInt(form.initialSupply as string) : 0;
  const color = generateTokenColor(name);
  const initials = symbol.slice(0, 2);
  const hasBurn = form.burnRate && parseInt(form.burnRate as string) > 0;
  const hasEcho = form.echoRate && parseInt(form.echoRate as string) > 0;
  const hasSupplyCap = form.supplyCap && parseInt(form.supplyCap as string) > 0;
  const chartHeights = generateChartHeights(`${name}:${symbol}`);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return; // 2MB max
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-[90%] rounded-2xl rounded-bl-none overflow-hidden border border-white/20 bg-gradient-to-br from-[#121212]/95 to-[#020202]/98 backdrop-blur-2xl text-white shadow-2xl shadow-black/80 transition-all duration-300">
      {/* Header bar */}
      <div className="px-4 py-3 bg-white/[0.02] border-b border-white/10 flex items-center justify-between font-serif tracking-widest">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-white/70 font-serif uppercase tracking-widest font-semibold">Tonkl Token Preview</span>
        </div>
        <span className="text-[10px] text-white/40 font-serif tracking-widest font-medium">TESTNET PROTOCOL</span>
      </div>

      {/* Token hero section */}
      <div className="p-5 font-serif">
        <div className="flex items-start gap-4 mb-5">
          {/* Token logo — clickable to upload */}
          <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={handleLogoUpload} />
          <div className="shrink-0 flex flex-col items-center gap-1">
            <button
              onClick={() => logoInputRef.current?.click()}
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold shadow-lg border border-white/20 relative group overflow-hidden transition-all hover:ring-2 hover:ring-white/20 cursor-pointer"
              style={logoPreview ? {} : { background: `linear-gradient(135deg, ${color}44, ${color}22)`, color: "white", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
              title="Click to upload a logo"
            >
              {logoPreview ? (
                <img src={logoPreview} alt="Token logo" className="w-full h-full object-cover rounded-2xl" />
              ) : (
                <>
                  <span className="font-serif tracking-wider font-bold text-white/90">{initials}</span>
                  <div className="absolute inset-0 bg-black/40 flex items-end justify-center pb-1 rounded-2xl">
                    <ImagePlus className="w-3.5 h-3.5 text-white/70" />
                  </div>
                </>
              )}
              {logoPreview && (
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-2xl">
                  <ImagePlus className="w-5 h-5 text-white/80" />
                </div>
              )}
            </button>
            {!logoPreview && (
              <button onClick={() => logoInputRef.current?.click()} className="text-[9px] text-white/40 hover:text-white/60 font-serif transition-colors cursor-pointer uppercase tracking-wider font-semibold">
                add logo
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className={`${isFullscreen ? "text-xl" : "text-lg"} font-serif font-bold text-white truncate`}>{name}</h3>
              {score === 100 && <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />}
            </div>
            <p className="text-white/50 font-serif text-sm tracking-wider">${symbol}</p>
          </div>
          {/* Category badge */}
          {form.category && (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-widest border shrink-0 bg-white/[0.03] shadow-sm"
              style={{ borderColor: `${color}40`, color: `${color}` }}>
              {form.category as string}
            </span>
          )}
        </div>

        {/* Mock price display */}
        <div className="mb-5 p-4 rounded-xl bg-white/[0.02] border border-white/5 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
          <div className="flex items-end justify-between mb-2">
            <span className={`${isFullscreen ? "text-3xl" : "text-2xl"} font-bold text-white font-serif`}>
              ${supply > 0 ? (1000000 / supply).toFixed(supply > 1000000 ? 6 : 4) : "0.00"}
            </span>
            <span className="text-emerald-400 text-xs font-serif uppercase tracking-widest font-semibold mb-1">New listing</span>
          </div>
          {/* Mini chart placeholder */}
          <div className="h-12 w-full rounded-lg bg-black/40 border border-white/5 flex items-end px-2 pb-1 gap-[2px] shadow-inner">
            {chartHeights.map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${h}%`, background: `linear-gradient(to top, ${color}60, ${color}aa)` }} />
            ))}
          </div>
        </div>

        {/* Token stats grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <StatBlock label="Total Supply" value={supply > 0 ? supply.toLocaleString() : "0"} sub={`$${symbol}`} />
          <StatBlock label="Market Cap" value={supply > 0 ? `$${(1000000).toLocaleString()}` : "$0"} sub="Estimated" />
          <StatBlock label="Decimals" value={String(form.decimals ?? 0)} sub="Precision" />
          <StatBlock label="Metadata" value={`${score}%`} sub={score === 100 ? "Verified" : "Standard"} color={score === 100 ? "#34d399" : "#fbbf24"} />
        </div>

        {/* On-chain features */}
        {(hasBurn || hasEcho || hasSupplyCap) && (
          <div className="mb-4 p-3 rounded-xl bg-white/[0.02] border border-white/5 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
            <p className="text-[10px] text-white/40 uppercase tracking-widest mb-2 font-serif font-semibold">On-Chain Features</p>
            <div className="flex flex-wrap gap-2">
              {hasBurn && (
                <span className="px-2.5 py-1 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-mono font-medium shadow-sm">
                  Burn {(parseInt(form.burnRate as string) / 100).toFixed(2)}%
                </span>
              )}
              {hasEcho && (
                <span className="px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-mono font-medium shadow-sm">
                  Echo {(parseInt(form.echoRate as string) / 100).toFixed(2)}%
                </span>
              )}
              {hasSupplyCap && (
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono font-medium shadow-sm">
                  Cap {parseInt(form.supplyCap as string).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Description */}
        {form.description && (
          <div className="mb-4 p-3 rounded-xl bg-white/[0.02] border border-white/5 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
            <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1.5 font-serif font-semibold">About</p>
            <p className="text-white/80 text-sm leading-relaxed font-serif">{form.description as string}</p>
          </div>
        )}

        {/* Missing fields hint */}
        {missing.length > 0 && (
          <div className="mb-4 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10 shadow-[0_2px_8px_rgba(245,158,11,0.02)]">
            <p className="text-amber-300 text-xs font-serif">Optional fields remaining: {missing.join(", ")}</p>
          </div>
        )}

        {/* Edit toggle */}
        <button onClick={() => setIsEditing(!isEditing)} className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 font-serif transition-colors mb-4 cursor-pointer select-none">
          {isEditing ? <ChevronUp className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
          <span className="font-semibold uppercase tracking-wider text-[10px]">{isEditing ? "Close editor" : "Edit details before minting"}</span>
        </button>

        <AnimatePresence>
          {isEditing && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <TokenInlineEditor form={form} onEdit={onEdit} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ZK proof note */}
        <p className="text-white/40 text-[11px] mb-4 text-center font-serif italic">
          Minting generates a ZK proof on-chain. This takes 30-60 seconds.
        </p>

        {/* Create button — Premium White Button with Black Serif writing for high contrast against the dark background */}
        <button
          onClick={onConfirm}
          disabled={isCreating || !form.symbol || !form.name}
          className="w-full py-4 bg-white text-black hover:bg-white/90 font-serif font-semibold rounded-xl flex items-center justify-center gap-2 text-xs uppercase tracking-widest transition-all duration-300 border border-black/10 shadow-lg disabled:bg-white/30 disabled:text-black/40 disabled:border-black/5 disabled:cursor-not-allowed disabled:shadow-none hover:shadow-[0_0_25px_rgba(255,255,255,0.25)] hover:scale-[1.01]"
        >
          {isCreating ? (
            <><Loader2 className="w-4 h-4 animate-spin text-black/60" /> Generating ZK Proof...</>
          ) : (
            <><Sparkles className="w-4 h-4 text-black/75" /> Create ${symbol} on Tonkl</>
          )}
        </button>
      </div>
    </div>
  );
}

function StatBlock({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
      <p className="text-[10px] text-white/40 uppercase tracking-widest font-serif font-semibold mb-1">{label}</p>
      <p className="text-white font-serif font-semibold text-sm" style={color ? { color } : {}}>{value}</p>
      <p className="text-white/30 text-[9px] font-mono">{sub}</p>
    </div>
  );
}

// ─── Token Inline Editor ───────────────────────────────────────

function TokenInlineEditor({ form, onEdit }: { form: Partial<TokenFormData>; onEdit: (field: string, value: string | number) => void }) {
  return (
    <div className="space-y-3 mb-3 p-4 rounded-xl bg-black/40 border border-white/10 shadow-[inset_0_2px_8px_rgba(0,0,0,0.4)]">
      <div className="grid grid-cols-2 gap-2">
        <EditField label="Symbol" value={form.symbol as string || ""} onChange={(v) => onEdit("symbol", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} />
        <EditField label="Name" value={form.name as string || ""} onChange={(v) => onEdit("name", v.slice(0, 64))} />
      </div>
      <EditField label="Description" value={form.description as string || ""} onChange={(v) => onEdit("description", v.slice(0, 500))} multiline />
      <div className="grid grid-cols-2 gap-2">
        <EditField label="Supply" value={form.initialSupply as string || "0"} onChange={(v) => onEdit("initialSupply", v.replace(/[^0-9]/g, ""))} />
        <div>
          <label className="block text-white/40 text-[10px] font-serif font-semibold uppercase tracking-wider mb-1">Category</label>
          <select value={form.category as string || "Utility"} onChange={(e) => onEdit("category", e.target.value)}
            className="w-full bg-black/50 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs font-serif focus:outline-none focus:border-white/30 focus:bg-black transition-all shadow-sm">
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
      <label className="block text-white/40 text-[10px] font-serif font-semibold uppercase tracking-wider mb-1">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2}
          className="w-full bg-black/50 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs font-serif focus:outline-none focus:border-white/30 focus:bg-black resize-none transition-all shadow-sm" />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full bg-black/50 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs font-serif focus:outline-none focus:border-white/30 focus:bg-black transition-all shadow-sm" />
      )}
    </div>
  );
}

// ─── Token Success Card ────────────────────────────────────────

function TokenSuccessCard({ msg, isFullscreen }: { msg: ChatMessage; isFullscreen: boolean }) {
  const token = msg.createdToken;
  if (!token) return null;

  return (
    <div className="max-w-[85%] rounded-2xl rounded-bl-none overflow-hidden border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-black/85 backdrop-blur-2xl text-white shadow-2xl transition-all duration-300">
      <div className="p-4 font-serif">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-inner">
            <CheckCircle className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h3 className={`${isFullscreen ? "text-xl" : "text-lg"} font-bold text-white font-serif`}>Token Created</h3>
            <p className="text-emerald-400 text-sm font-medium tracking-wide">{token.symbol} is live on Tonkl</p>
          </div>
        </div>

        {msg.warning && (
          <div className="mb-4 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10 shadow-sm">
            <p className="text-amber-200 text-xs flex items-center gap-2 font-serif">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" /> {msg.warning}
            </p>
          </div>
        )}

        <div className="space-y-2 mb-4 bg-white/[0.02] p-3 rounded-xl border border-white/10 shadow-sm">
          <TokenDetailRow label="Symbol" value={token.symbol} mono />
          <TokenDetailRow label="Asset ID" value={token.assetId} mono />
          <TokenDetailRow label="Tier"><TierBadge tier={token.tier} /></TokenDetailRow>
          <TokenDetailRow label="Risk" last><RiskBadge score={token.riskScore} /></TokenDetailRow>
        </div>

        {token.riskDetails.length > 0 && (
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1 font-semibold">Notes</p>
            {token.riskDetails.map((d, i) => <p key={i} className="text-white/60 text-xs leading-relaxed">{d}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}

function TokenDetailRow({ label, value, mono, last, children }: { label: string; value?: string; mono?: boolean; last?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`flex justify-between items-center py-2 ${!last ? "border-b border-white/5" : ""}`}>
      <span className="text-white/50 text-xs font-serif font-medium">{label}</span>
      {children || <span className={`text-white/90 text-xs font-serif font-medium ${mono ? "font-mono tracking-tight" : ""}`}>{value}</span>}
    </div>
  );
}

// ─── Extracted Fields Badge ────────────────────────────────────

function ExtractedFieldsBadge({ fields }: { fields: Partial<TokenFormData> }) {
  return (
    <div className="mt-3 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 shadow-sm">
      <p className="text-[10px] text-purple-400 font-serif font-semibold uppercase tracking-wider mb-1.5">Extracted fields</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(fields).map(([key, val]) => (
          <span key={key} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/[0.02] border border-white/10 text-xs text-white/80 font-serif shadow-sm">
            <span className="text-white/50 capitalize font-medium">{key.replace(/([A-Z])/g, " $1").trim()}:</span>
            <span className="text-white font-mono font-medium">{String(val)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Generic Preview Card ──────────────────────────────────────

function GenericPreviewCard({ preview, executionEnabled, isCancelled, onCancel }: {
  preview: TonklAIPreview; executionEnabled: boolean; isCancelled: boolean; onCancel: () => void;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#121212]/95 to-[#020202]/98 backdrop-blur-2xl text-white shadow-lg font-serif">
      <div className="flex items-start gap-3 border-b border-white/10 p-3 bg-white/[0.02]">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.02] shadow-sm text-emerald-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-serif font-bold text-white">{preview.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/70">{preview.summary}</p>
        </div>
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        {Object.entries(preview.fields).map(([key, value]) => (
          <div key={key} className="min-w-0 rounded-lg border border-white/5 bg-white/[0.02] p-2 shadow-sm">
            <p className="text-[9px] uppercase tracking-wider text-white/40 font-serif font-semibold">{key.replaceAll("_", " ")}</p>
            <p className="mt-1 break-words text-xs text-white/90 font-serif font-medium">{String(value ?? "")}</p>
          </div>
        ))}
      </div>
      {preview.warnings.length > 0 && (
        <div className="space-y-2 border-t border-white/10 p-3 bg-amber-500/5">
          {preview.warnings.map((w) => (
            <div key={w} className="flex gap-2 text-xs leading-relaxed text-amber-200 font-serif">
              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" /><span>{w}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-white/10 p-3 bg-white/[0.02] sm:flex-row sm:items-center sm:justify-end">
        <button type="button" onClick={onCancel} disabled={isCancelled}
          className="h-9 rounded-lg border border-white/10 px-3 text-xs font-serif font-semibold text-white/75 bg-white/[0.03] hover:bg-white hover:text-black transition-all shadow-sm cursor-pointer uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed">
          {isCancelled ? "Cancelled" : "Cancel"}
        </button>
        <button type="button" disabled
          className="h-9 rounded-lg border border-white/10 bg-white/5 text-white/30 px-3 text-xs font-serif font-semibold uppercase tracking-wider"
          title={executionEnabled ? "Live execution is not connected in this beta route." : "This preview cannot execute."}>
          Confirm locked
        </button>
      </div>
    </div>
  );
}

// ─── Utility ───────────────────────────────────────────────────

function RiskBadge({ score }: { score: RiskScore }) {
  const colors = {
    low: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
    medium: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
    high: { text: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
    critical: { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" }
  }[score];

  const label = { low: "Low Risk", medium: "Medium Risk", high: "High Risk", critical: "Critical Risk" }[score];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-serif font-semibold ${colors.text} ${colors.bg} border ${colors.border} shadow-sm`}>
      <Shield className="w-2.5 h-2.5" /> {label}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  if (tier === "verified") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-serif font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 shadow-sm">
      <CheckCircle className="w-2.5 h-2.5 text-emerald-400" /> Verified
    </span>
  );
  if (tier === "unverified") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-serif font-semibold text-red-400 bg-red-500/10 border border-red-500/30 shadow-sm">
      <AlertTriangle className="w-2.5 h-2.5 text-red-400" /> Unverified
    </span>
  );
  return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-serif font-semibold text-white/70 bg-white/5 border border-white/10 shadow-sm">Standard</span>;
}

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function assistantBubbleClass(kind?: MessageKind) {
  if (kind === "blocked") return "bg-red-500/10 text-red-50 border border-red-500/25 shadow-[0_0_15px_rgba(239,68,68,0.12)] rounded-bl-sm";
  if (kind === "error") return "bg-amber-500/10 text-amber-50 border border-amber-500/25 shadow-[0_0_15px_rgba(245,158,11,0.12)] rounded-bl-sm";
  return "bg-white/90 backdrop-blur-xl text-black shadow-md border border-white/20 rounded-bl-sm";
}

function formatModelStatus(status: TonklAIModelStatus, modelName?: string | null) {
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
