"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Maximize2, Minimize2, Bot, Ban, ShieldCheck } from "lucide-react";
import { Warp } from "@paper-design/shaders-react";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import SiriOrb from "@/components/ui/siri-orb";

interface ShlemChatOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

type ChatMessage = {
  id: string;
  text: string;
  isUser: boolean;
  kind?: ShlemResponseKind;
  preview?: ShlemPreview | null;
  executionEnabled?: boolean;
  modelStatus?: ShlemModelStatus;
  modelName?: string | null;
};

type ShlemResponseKind = "blocked" | "preview" | "error" | "read" | "message";
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

type ShlemApiResponse = {
  reply?: string;
  kind?: ShlemResponseKind;
  preview?: ShlemPreview | null;
  executionEnabled?: boolean;
  modelStatus?: ShlemModelStatus;
  modelName?: string | null;
};

export function ShlemChatOverlay({ isOpen, onClose }: ShlemChatOverlayProps) {
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isShlemSpeaking, setIsShlemSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cancelledPreviewIds, setCancelledPreviewIds] = useState<Set<string>>(() => new Set());
  
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", text: "I am Shlem, your encrypted assistant for the Tonkl network.", isUser: false },
  ]);

  // Simulate voice interaction flow
  useEffect(() => {
    let timeout1: NodeJS.Timeout;
    let timeout2: NodeJS.Timeout;
    
    if (isVoiceMode) {
      // After 2 seconds, simulate Shlem talking back (vibrating/melting orb)
      timeout1 = setTimeout(() => {
        setIsShlemSpeaking(true);
      }, 2000);
      
      // Stop talking after 6 seconds
      timeout2 = setTimeout(() => {
        setIsShlemSpeaking(false);
      }, 6000);
    }
    
    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
    };
  }, [isVoiceMode]);

  const handleSend = async (text: string, files?: File[]) => {
    const trimmedText = text.trim();
    const messageText = trimmedText || (files?.length ? "[Attachment]" : "");
    if (!messageText || isLoading) return;
    const history = messages
      .filter((message) => message.id !== "welcome")
      .slice(-12)
      .map((message) => ({
        role: message.isUser ? "user" : "assistant",
        content: message.text,
      }));

    setMessages((prev) => [...prev, { id: createMessageId(), text: messageText, isUser: true }]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/shlem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageText, history }),
      });

      const data = await response.json().catch(() => null) as ShlemApiResponse | null;
      const reply = data?.reply || "I could not read the Shlem response from the local route.";

      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          text: reply,
          isUser: false,
          kind: data?.kind || (response.ok ? "message" : "error"),
          preview: data?.preview || null,
          executionEnabled: Boolean(data?.executionEnabled),
          modelStatus: data?.modelStatus || "unknown",
          modelName: data?.modelName || null,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          text: "I could not reach the local Shlem route. Check that the Next dev server is running and that the Shlem folder is available on this machine.",
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
      {
        id: createMessageId(),
        text: `Preview ${previewId} cancelled. No funds moved and nothing was signed.`,
        isUser: false,
        kind: "message",
      },
    ]);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop for fullscreen mode - positioned next to the sidebar */}
          {isFullscreen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-y-0 right-0 left-20 z-[40] bg-[#020202] overflow-hidden"
              onClick={onClose}
            >
              <div className="absolute inset-0 z-0 pointer-events-none">
                <Warp
                  style={{ height: "100%", width: "100%" }}
                  proportion={0.5}
                  softness={1.2}
                  distortion={0.35}
                  swirl={1.5}
                  swirlIterations={15}
                  shape="checks"
                  shapeScale={0.1}
                  scale={1}
                  rotation={0}
                  speed={1.2}
                  colors={[
                    "hsl(220, 100%, 12%)",    // Deep royal blue
                    "hsl(180, 100%, 18%)",    // Deep cyan
                    "hsl(200, 80%, 8%)",      // Very dark blue
                    "hsl(190, 90%, 22%)"      // Vibrant deep sea blue
                  ]}
                />
              </div>
              <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/10 via-transparent to-black/70 pointer-events-none" />
            </motion.div>
          )}

          {/* Chat Container */}
          <motion.div
            initial={isFullscreen ? { opacity: 0, scale: 0.95, y: 20 } : { opacity: 0, y: 20, scale: 0.9 }}
            animate={isFullscreen ? { opacity: 1, scale: 1, y: 0 } : { opacity: 1, y: 0, scale: 1 }}
            exit={isFullscreen ? { opacity: 0, scale: 0.95, y: 20 } : { opacity: 0, y: 20, scale: 0.9 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={`fixed z-[50] flex flex-col overflow-hidden transition-all duration-500 ease-in-out ${
              isFullscreen
                ? "inset-y-4 right-4 left-24 md:inset-y-12 md:right-12 md:left-[8.5rem] lg:inset-y-12 lg:right-32 lg:left-52 bg-transparent" // Fullscreen (floating over center)
                : "bottom-6 right-6 w-[380px] h-[600px] bg-[#0a0a0a]/95 backdrop-blur-2xl rounded-2xl border border-cyan-500/20 shadow-[0_0_40px_rgba(34,211,238,0.15)]"
            }`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between p-4 ${!isFullscreen && "border-b border-white/10"}`}>
              <div className="flex items-center gap-3">
                <div className={`flex items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 ${isFullscreen ? "w-12 h-12 shadow-[0_0_20px_rgba(34,211,238,0.2)]" : "w-8 h-8"}`}>
                  <Bot className={`text-cyan-400 ${isFullscreen ? "w-6 h-6" : "w-4 h-4"}`} />
                </div>
                <div>
                  <h2 className={`font-semibold text-white ${isFullscreen ? "text-2xl" : "text-base"}`}>Shlem AI</h2>
                  {isFullscreen && <p className="text-cyan-400/70 text-sm">Encrypted Network Assistant</p>}
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 rounded-lg transition-colors"
                >
                  {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                >
                  <X className={isFullscreen ? "w-6 h-6" : "w-5 h-5"} />
                </button>
              </div>
            </div>

            {/* Main Content Area (Chat or Voice Orb) */}
            <AnimatePresence mode="wait">
              {!isVoiceMode ? (
                <motion.div
                  key="chat"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={`flex-1 overflow-y-auto p-4 space-y-6 ${isFullscreen ? "px-12" : "px-4"}`}
                >
                  {messages.map((msg) => (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={msg.id}
                      className={`flex ${msg.isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl p-4 ${
                          msg.isUser
                            ? "bg-black text-white rounded-br-none border border-white/5 shadow-lg"
                            : assistantBubbleClass(msg.kind)
                        }`}
                      >
                        <p className={`${isFullscreen ? "text-lg" : "text-sm"} whitespace-pre-wrap`}>{msg.text}</p>
                        {msg.preview && (
                          <ShlemPreviewCard
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
                    </motion.div>
                  ))}
                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-start"
                    >
                      <div className="max-w-[80%] rounded-2xl rounded-bl-none p-4 bg-cyan-500/10 text-cyan-50 border border-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.1)]">
                        <p className={`${isFullscreen ? "text-lg" : "text-sm"} animate-pulse`}>
                          Shlem is checking the local route...
                        </p>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="voice"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex-1 flex flex-col items-center justify-center p-4 relative"
                >
                  <SiriOrb 
                    isSpeaking={isShlemSpeaking} 
                    size={isFullscreen ? "400px" : "250px"} 
                  />
                  <p className="mt-8 text-cyan-400/70 font-mono text-sm animate-pulse">
                    {isShlemSpeaking ? "Shlem AI is speaking..." : "Listening to your voice..."}
                  </p>
                  <button 
                    onClick={() => {
                      setIsVoiceMode(false);
                      setIsShlemSpeaking(false);
                    }}
                    className="mt-8 px-6 py-2 rounded-full border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors shadow-[0_0_15px_rgba(239,68,68,0.15)]"
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
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className={`p-4 ${isFullscreen ? "px-12 pb-8 max-w-4xl mx-auto w-full" : "pt-2"}`}
                >
                  <PromptInputBox 
                    onSend={(msg) => handleSend(msg)}
                    onVoiceModeToggle={(active) => {
                      setIsVoiceMode(active);
                      if (!active) setIsShlemSpeaking(false);
                    }}
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

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function assistantBubbleClass(kind: ShlemResponseKind = "message") {
  if (kind === "blocked") {
    return "bg-red-500/10 text-red-50 border border-red-500/25 shadow-[0_0_15px_rgba(239,68,68,0.12)] rounded-bl-none";
  }

  if (kind === "error") {
    return "bg-amber-500/10 text-amber-50 border border-amber-500/25 shadow-[0_0_15px_rgba(245,158,11,0.12)] rounded-bl-none";
  }

  return "bg-cyan-500/10 text-cyan-50 border border-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.1)] rounded-bl-none";
}

function formatModelStatus(status: ShlemModelStatus, modelName?: string | null) {
  if (status === "connected") {
    return modelName ? `Llama connected: ${modelName}` : "Llama connected";
  }

  if (status === "fallback") {
    return "Model fallback";
  }

  if (status === "disabled") {
    return "Model disabled";
  }

  if (status === "skipped_blocked") {
    return "Blocked before model";
  }

  return "Model status unknown";
}

function ShlemPreviewCard({
  preview,
  executionEnabled,
  isCancelled,
  onCancel,
}: {
  preview: ShlemPreview;
  executionEnabled: boolean;
  isCancelled: boolean;
  onCancel: () => void;
}) {
  const fields = Object.entries(preview.fields);

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
        {fields.map(([key, value]) => (
          <div key={key} className="min-w-0 rounded-md border border-white/10 bg-white/[0.03] p-2">
            <p className="text-[10px] uppercase tracking-wide text-cyan-200/50">{formatFieldLabel(key)}</p>
            <p className="mt-1 break-words text-xs text-white">{String(value ?? "")}</p>
          </div>
        ))}
      </div>

      {preview.warnings.length > 0 && (
        <div className="space-y-2 border-t border-cyan-300/10 p-3">
          {preview.warnings.map((warning) => (
            <div key={warning} className="flex gap-2 text-xs leading-relaxed text-cyan-50/70">
              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-cyan-300/10 p-3 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={isCancelled}
          className="h-9 rounded-md border border-white/10 px-3 text-xs font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/35"
        >
          {isCancelled ? "Cancelled" : "Cancel"}
        </button>
        <button
          type="button"
          disabled
          className="h-9 rounded-md border border-cyan-300/15 bg-cyan-300/10 px-3 text-xs font-medium text-cyan-100/45"
          title={executionEnabled ? "Live execution is not connected in this beta route." : "This preview cannot execute."}
        >
          Confirm locked
        </button>
      </div>
    </div>
  );
}

function formatFieldLabel(value: string) {
  return value.replaceAll("_", " ");
}
