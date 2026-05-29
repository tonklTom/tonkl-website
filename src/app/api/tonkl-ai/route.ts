import { spawn } from "node:child_process";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { validateSession } from "@/lib/session";
import { maskSecretText } from "@/lib/secret-mask";

export const runtime = "nodejs";

const DEFAULT_TONKL_AI_DIR = process.env.TONKL_AI_DIR || "";
const DEFAULT_NODE_URL = "http://127.0.0.1:9100";
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CONTENT_LENGTH = 1200;
const REQUEST_TIMEOUT_MS = 60_000; // llama3.2 on local hardware can be slow
const MAX_STDOUT_SIZE = 32_768; // Cap stdout to prevent memory exhaustion

// ─── Rate limit: 20 requests per minute per IP ──────────────────
const RATE_LIMIT = { max: 20, windowMs: 60_000 };

// ─── Concurrent execution limit ─────────────────────────────────
const MAX_CONCURRENT = 3;
let activeTonklAI = 0;

type TonklAIHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

type TonklAIPayload = {
  message?: string;
  blocked?: boolean;
  intent?: string;
  plan?: {
    requires_confirmation?: boolean;
  } | null;
  warnings?: string[];
  model?: {
    ok?: boolean;
    name?: string | null;
    status?: "connected" | "fallback" | "disabled" | "skipped_blocked";
    text?: string;
    error?: string;
  };
  execution?: {
    ok?: boolean;
    message?: string;
    error?: string | null;
    data?: TonklAIExecutionData;
  } | null;
};

type TonklAIExecutionData = {
  requires_confirmation?: boolean;
  execution_enabled?: boolean;
  preview?: TonklAIPreview;
  json?: unknown;
  text?: string;
  error?: {
    suggestions?: string[];
  };
} & Record<string, unknown>;

type TonklAIPreview = {
  preview_id: string;
  action: string;
  title: string;
  summary: string;
  fields: Record<string, string>;
  warnings: string[];
  confirmation_text: string;
  can_execute: boolean;
};

type TonklAIResponseKind = "blocked" | "preview" | "error" | "read" | "message";

type TonklAIResponseSummary = {
  kind: TonklAIResponseKind;
  preview: TonklAIPreview | null;
  requiresConfirmation: boolean;
  executionEnabled: boolean;
  modelStatus: "connected" | "fallback" | "disabled" | "skipped_blocked" | "unknown";
  modelName: string | null;
};

type TonklAIApiResponse = {
  reply: string;
  payload: TonklAIPayload;
} & TonklAIResponseSummary;

type TonklAIErrorResponse = {
  error: string;
  reply: string;
  detail?: string;
};

export async function POST(request: Request) {
  // ── Rate limit ──────────────────────────────────────────────
  const clientKey = getClientKey(request);
  const limited = checkRateLimit("tonkl-ai", clientKey, RATE_LIMIT);
  if (limited) return limited;

  // ── Concurrent limit ────────────────────────────────────────
  if (activeTonklAI >= MAX_CONCURRENT) {
    return Response.json(
      { error: "server_busy", reply: "Tonkl AI is handling other requests. Try again in a moment." },
      { status: 503 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json", reply: "I could not read that request as JSON." }, { status: 400 });
  }

  const message = typeof (body as { message?: unknown }).message === "string"
    ? (body as { message: string }).message.trim()
    : "";

  if (!message) {
    return Response.json({ error: "empty_message", reply: "Send me a message to route through Tonkl AI." }, { status: 400 });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json(
      {
        error: "message_too_long",
        reply: `That message is too long for the local beta route. Keep it under ${MAX_MESSAGE_LENGTH} characters.`,
      },
      { status: 400 }
    );
  }

  try {
    const context = typeof (body as { context?: unknown }).context === "string"
      ? (body as { context: string }).context
      : undefined;
    const currentForm = (body as { currentForm?: unknown }).currentForm as Record<string, unknown> | undefined;
    const history = parseHistory((body as { history?: unknown }).history);
    const session = validateSession(request);

    if (!session && requiresWalletSession(message, context)) {
      return Response.json(buildWalletSessionRequiredResponse(), { status: 401 });
    }

    const payload = await runTonklAI(message, history, context, Boolean(session));

    // When in token_creation context, extract fields and override generic fallback replies
    // But first check if the user is exiting token creation
    const isExiting = context === "token_creation" && isExitingTokenCreation(message);
    if (context === "token_creation" && !isExiting) {
      const extracted = extractTokenFields(message, currentForm);

      // Determine what the guided flow needs next
      const merged = { ...(currentForm || {}), ...extracted };
      const nextField = getNextMissingField(merged);

      // Template reply as fallback (always available)
      const guidedReply = buildTokenCreationReply(extracted, currentForm);

      // ── LLM-first strategy ──────────────────────────────────
      // For conversational steps (name, symbol, supply, description), call the LLM
      // directly with a step-specific system prompt. The LLM writes the full reply.
      // Template is fallback only if the LLM fails or returns garbage.
      // For structural steps (features, done), templates are better because the
      // content is too structured (option lists, preview cards) for an 8B model.
      if (nextField !== "done" && nextField !== "features") {
        const stepMessages = buildTokenStepPrompt(nextField, merged, message);
        if (stepMessages.length > 0) {
          const llmReply = await callTokenLLM(stepMessages);
          if (llmReply && llmReply.length > 15 && !llmReply.includes("```")) {
            // Strip any markdown bold the LLM might add
            payload.message = llmReply.replace(/\*\*/g, "");
          } else {
            payload.message = guidedReply;
          }
        } else {
          payload.message = guidedReply;
        }
      } else {
        // Features and done steps use templates (too structured for LLM)
        payload.message = guidedReply;
      }

      // ── LLM-generated description ───────────────────────────
      // When the description step just completed, try the LLM for the description
      // text before falling back to the template generator.
      if (nextField === "features" && extracted.description) {
        const name = String(merged.name || "");
        const symbol = String(merged.symbol || "").toUpperCase();
        const inferredCat = inferCategoryFromDescription(String(extracted.description), name);
        const llmDesc = await generateLLMDescription(
          String(extracted.description), name, symbol, inferredCat,
        );
        if (llmDesc && llmDesc.length > 30 && llmDesc.length < 500) {
          // Use LLM description instead of template-generated one
          extracted.description = llmDesc.replace(/\*\*/g, "");
          // Rebuild the guided reply with the LLM description
          payload.message = buildTokenCreationReply(extracted, currentForm);
        }
      }

      if (payload.model) payload.model.text = payload.message;

      // In token_creation context, ALWAYS force the intent
      payload.intent = "create_token";

      // Make sure extracted fields reach frontend
      if (Object.keys(extracted).length > 0) {
        if (!payload.execution) {
          payload.execution = { ok: true, message: "Fields extracted.", data: {} };
        }
        if (!payload.execution.data) {
          payload.execution.data = {} as TonklAIExecutionData;
        }
        (payload.execution.data as Record<string, unknown>).extracted_fields = extracted;
      }
    }

    const summary = summarizeTonklAIPayload(payload);
    const response: TonklAIApiResponse = {
      // In token_creation context, always use the guided wizard reply
      reply: context === "token_creation" && payload.message
        ? payload.message
        : formatTonklAIReply(payload),
      payload,
      ...summary,
    };

    return Response.json(response);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown local Tonkl AI bridge error";
    const response: TonklAIErrorResponse = {
      error: "tonkl_ai_bridge_failed",
      reply: "I could not reach the local Tonkl AI service. Make sure TONKL_AI_DIR is set in your .env.local and that Python can run the Tonkl AI CLI.",
      detail,
    };

    return Response.json(
      response,
      { status: 500 }
    );
  }
}

function parseHistory(value: unknown): TonklAIHistoryTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-MAX_HISTORY_TURNS)
    .flatMap((item): TonklAIHistoryTurn[] => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
        return [];
      }

      const trimmed = content.trim();
      if (!trimmed) {
        return [];
      }

      return [{ role, content: trimmed.slice(0, MAX_HISTORY_CONTENT_LENGTH) }];
    });
}

function requiresWalletSession(message: string, context?: string): boolean {
  if (context === "token_creation") {
    return false;
  }

  const lower = message.toLowerCase();
  // Skip wallet check if the message is about creating/designing a token (guided flow doesn't need wallet until mint)
  if (/\b(?:create|make|design|build|launch)\s+(?:a\s+)?token\b/i.test(lower) ||
      /\btoken\s+(?:idea|concept|project|creation)\b/i.test(lower)) {
    return false;
  }
  return [
    /\b(?:my|wallet|account)\s+(?:balance|balances|assets?|tokens?|notes?|history|transactions?|address)\b/,
    /\b(?:my|check|show|view)\s+(?:balance|balances|assets?|notes?|history|transactions?)\b/,
    /\b(?:send|transfer|pay|receive|scan|sync|faucet|drip|stake|unstake)\b/,
    /\b(?:mint|deploy)\s+(?:a\s+)?token\b/,
    /\b(?:use|read|check|show)\s+(?:my\s+)?(?:wallet|funds|transactions?|notes?)\b/,
  ].some((pattern) => pattern.test(lower));
}

function buildWalletSessionRequiredResponse(): TonklAIApiResponse {
  const reply = "I can talk you through that, but I need an unlocked Tonkl wallet session before I read balances, inspect wallet history, prepare sends, use the faucet, or touch token actions.";

  return {
    reply,
    kind: "error",
    preview: null,
    requiresConfirmation: false,
    executionEnabled: false,
    modelStatus: "skipped_blocked",
    modelName: null,
    payload: {
      message: reply,
      blocked: true,
      intent: "wallet_session_required",
      model: {
        ok: false,
        name: null,
        status: "skipped_blocked",
        text: reply,
      },
      execution: {
        ok: false,
        message: reply,
        error: "wallet_session_required",
        data: {
          error: {
            suggestions: [
              "Create or unlock your wallet first.",
              "Then ask Tonkl AI again and the request will include your wallet session.",
            ],
          },
        },
      },
    },
  };
}

function runTonklAI(
  message: string,
  history: TonklAIHistoryTurn[],
  context?: string,
  allowWalletAccess = false,
): Promise<TonklAIPayload> {
  const tonklAiDir = process.env.TONKL_AI_DIR || DEFAULT_TONKL_AI_DIR;
  const python = process.env.TONKL_AI_PYTHON || "python3";
  const pythonPath = `${tonklAiDir}/src`;
  const nodeUrl = (
    process.env.TONKL_AI_NODE_URL
    || process.env.TONKL_NODE_URL
   
    || DEFAULT_NODE_URL
  );
  const walletCmd = allowWalletAccess ? buildWalletCommand(nodeUrl) : undefined;
  const args = ["-m", "tonkl_ai.cli", message, "--json", "--node-url", nodeUrl];
  if (history.length > 0) {
    args.push("--history-json", JSON.stringify(history));
  }
  if (walletCmd) {
    args.push("--wallet-cmd", walletCmd);
  }
  if (context) {
    args.push("--context", context);
  }
  if (shouldCaptureLearning()) {
    args.push("--learn");
  }
  // LLM responses are now the default in the Tonkl AI CLI.
  // Pass --no-model only if explicitly disabled via env.
  if (shouldDisableModel()) {
    args.push("--no-model");
  }

  return new Promise((resolve, reject) => {
    activeTonklAI++;

    // SECURITY: Only pass minimum required env vars — never spread process.env
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH || "/usr/bin:/usr/local/bin",
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
      TONKL_AI_NODE_URL: nodeUrl,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${pythonPath}:${process.env.PYTHONPATH}`
        : pythonPath,
    };
    if (walletCmd) safeEnv.TONKL_AI_WALLET_CMD = walletCmd;
    // Pass LLM model config so Tonkl AI can reach a local or hosted Llama endpoint.
    if (process.env.TONKL_AI_MODEL_BASE_URL) safeEnv.TONKL_AI_MODEL_BASE_URL = process.env.TONKL_AI_MODEL_BASE_URL;
    if (process.env.TONKL_AI_MODEL_NAME) safeEnv.TONKL_AI_MODEL_NAME = process.env.TONKL_AI_MODEL_NAME;
    if (process.env.TONKL_AI_MODEL_API_KEY) safeEnv.TONKL_AI_MODEL_API_KEY = process.env.TONKL_AI_MODEL_API_KEY;
    if (process.env.VIRTUAL_ENV) safeEnv.VIRTUAL_ENV = process.env.VIRTUAL_ENV;
    if (process.env.NARGO_PATH) {
      safeEnv.PATH = `${process.env.NARGO_PATH}:${safeEnv.PATH}`;
    }

    const child = spawn(
      python,
      args,
      {
        cwd: tonklAiDir,
        env: safeEnv,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      activeTonklAI--;
      reject(new Error("Tonkl AI CLI timed out"));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      // SECURITY: Cap stdout to prevent memory exhaustion
      if (stdout.length < MAX_STDOUT_SIZE) stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      activeTonklAI--;
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      activeTonklAI--;

      if (code !== 0) {
        reject(new Error(stderr.trim() || `Tonkl AI CLI exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as TonklAIPayload);
      } catch {
        reject(new Error("Tonkl AI CLI returned non-JSON output"));
      }
    });
  });
}

function formatTonklAIReply(payload: TonklAIPayload): string {
  if (payload.blocked) {
    return payload.message || "That request is blocked by Tonkl AI's safety policy.";
  }

  if (payload.model?.ok && payload.model.text) {
    return payload.model.text;
  }

  const execution = payload.execution;
  if (!execution) {
    return payload.message || "Tonkl AI prepared a response, but there was no execution context.";
  }

  const suggestions = execution.data?.error?.suggestions || [];
  const nextSteps = suggestions.length
    ? `\n\nNext steps:\n${suggestions.map((suggestion) => `- ${suggestion}`).join("\n")}`
    : "";
  const readData = execution.ok ? formatReadOnlyData(execution.data, payload.intent) : "";
  const readBlock = readData ? `\n\n${readData}` : "";

  return `${execution.message || payload.message || "Tonkl AI completed the local route."}${readBlock}${nextSteps}`;
}

function summarizeTonklAIPayload(payload: TonklAIPayload): TonklAIResponseSummary {
  const execution = payload.execution;
  const preview = execution?.data?.preview || null;
  const requiresConfirmation = Boolean(
    preview || execution?.data?.requires_confirmation || payload.plan?.requires_confirmation
  );
  const executionEnabled = Boolean(execution?.data?.execution_enabled || preview?.can_execute);
  const modelStatus = (payload.model?.status || "unknown") as TonklAIResponseSummary["modelStatus"];
  const modelName = payload.model?.name || null;

  if (payload.blocked) {
    return {
      kind: "blocked",
      preview: null,
      requiresConfirmation: false,
      executionEnabled: false,
      modelStatus,
      modelName,
    };
  }

  if (preview) {
    return {
      kind: "preview",
      preview,
      requiresConfirmation: true,
      executionEnabled,
      modelStatus,
      modelName,
    };
  }

  if (execution?.ok === false || execution?.error) {
    return {
      kind: "error",
      preview: null,
      requiresConfirmation,
      executionEnabled: false,
      modelStatus,
      modelName,
    };
  }

  if (execution?.ok === true) {
    return {
      kind: "read",
      preview: null,
      requiresConfirmation,
      executionEnabled,
      modelStatus,
      modelName,
    };
  }

  return {
    kind: "message",
    preview: null,
    requiresConfirmation,
    executionEnabled,
    modelStatus,
    modelName,
  };
}

function buildWalletCommand(nodeUrl: string): string | undefined {
  if (process.env.TONKL_AI_WALLET_CMD) {
    return process.env.TONKL_AI_WALLET_CMD;
  }

  const walletScript = process.env.TONKL_WALLET_SCRIPT;
  if (!walletScript) {
    return undefined;
  }

  const command = [
    process.env.TONKL_PYTHON || "python3",
    walletScript,
    "--node-url",
    nodeUrl,
    "--json",
  ];
  const walletDb = process.env.TONKL_WALLET_DB;
  if (walletDb) {
    command.push("--db", walletDb);
  }

  return command.map(quoteCommandPart).join(" ");
}

function shouldCaptureLearning(): boolean {
  return ["1", "true", "yes"].includes((process.env.TONKL_AI_LEARN || "").toLowerCase());
}

function shouldDisableModel(): boolean {
  return ["1", "true", "yes"].includes((process.env.TONKL_AI_NO_MODEL || "").toLowerCase());
}

function quoteCommandPart(part: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(part)) {
    return part;
  }

  return `'${part.replaceAll("'", "'\"'\"'")}'`;
}

function formatReadOnlyData(data: TonklAIExecutionData | undefined, intent?: string): string {
  if (!data || data.preview || data.error) {
    return "";
  }

  if (intent === "wallet_balance") {
    const balance = formatBalanceData(data);
    if (balance) {
      return balance;
    }
  }

  if (typeof data.text === "string") {
    return trimReadOnlySummary(data.text);
  }

  if (data.json !== undefined) {
    return trimReadOnlySummary(JSON.stringify(data.json, null, 2));
  }

  const filtered = Object.fromEntries(
    Object.entries(data).filter(([key]) => !["requires_confirmation", "execution_enabled"].includes(key))
  );

  if (Object.keys(filtered).length === 0) {
    return "";
  }

  return trimReadOnlySummary(JSON.stringify(filtered, null, 2));
}

function formatBalanceData(data: TonklAIExecutionData): string {
  const source = readWalletJson(data);
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return "";
  }

  const balances = (source as { balances?: unknown }).balances;
  if (!balances || typeof balances !== "object" || Array.isArray(balances)) {
    return "";
  }

  const entries = Object.entries(balances as Record<string, unknown>);
  if (entries.length === 0) {
    return "Your wallet balance is 0 TNK. Estimated USD value: $0.00.";
  }

  const lines = entries.map(([assetId, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const item = value as Record<string, unknown>;
      const formatted = typeof item.formatted === "string" ? item.formatted : null;
      const raw = item.raw;
      const asset = typeof item.asset === "string" ? item.asset : `asset ${assetId}`;
      return formatted ? `${asset}: ${formatted}` : `${asset}: ${String(raw ?? 0)}`;
    }

    return `Asset ${assetId}: ${String(value)}`;
  });

  return `${lines.join("\n")}\n\nUSD estimate is not connected yet, so I can show token amounts but not a live dollar value.`;
}

function readWalletJson(data: TonklAIExecutionData): unknown {
  if (data.json !== undefined) {
    return data.json;
  }

  const nested = data as { json?: unknown; data?: { json?: unknown } };
  return nested.data?.json;
}

function trimReadOnlySummary(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const maxLength = 1600;
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}\n...`
    : trimmed;
}

// ─── Direct LLM call for token creation flow ─────────────────
// Bypasses the Python CLI and calls Ollama directly with step-specific prompts.
// This gives us full control over the system prompt per step, so the LLM writes
// natural replies while the regex extraction handles field parsing separately.

const LLM_BASE_URL = process.env.TONKL_AI_MODEL_BASE_URL || "http://127.0.0.1:11434/v1";
const LLM_MODEL = process.env.TONKL_AI_MODEL_NAME || "llama3.2";
const LLM_API_KEY = process.env.TONKL_AI_MODEL_API_KEY || "ollama";
const LLM_TIMEOUT_MS = 30_000;

type LLMMessage = { role: "system" | "user" | "assistant"; content: string };

async function callTokenLLM(messages: LLMMessage[]): Promise<string | null> {
  try {
    const safeMessages = messages.map((message) => ({
      ...message,
      content: maskSecretText(message.content).text,
    }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: safeMessages,
        temperature: 0.7,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json() as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

const TOKEN_SYSTEM_BASE = `You are Tonkl AI, the assistant for the Tonkl privacy blockchain network. You're helping a user create a custom token through conversation. Be warm, concise, and knowledgeable. Never use markdown bold (**text**). Keep responses under 3 sentences unless explaining options. Sound like a smart friend who knows crypto, not a corporate chatbot.`;

function buildTokenStepPrompt(
  nextField: string,
  merged: MergedForm,
  userMessage: string,
): LLMMessage[] {
  const name = String(merged.name || "");
  const symbol = String(merged.symbol || "").toUpperCase();
  const supply = String(merged.initialSupply || "");
  const desc = String(merged.description || "");

  const formSummary = [
    name && `Name: ${name}`,
    symbol && `Symbol: $${symbol}`,
    supply && supply !== "0" && `Supply: ${parseInt(supply).toLocaleString()}`,
    desc && desc.length >= 10 && `Description: ${desc}`,
  ].filter(Boolean).join("\n");

  const contextBlock = formSummary
    ? `\nToken so far:\n${formSummary}\n`
    : "\nNo fields collected yet.\n";

  let stepInstruction = "";

  switch (nextField) {
    case "name":
      stepInstruction = `The user wants to create a token but hasn't given a name yet. Acknowledge what they said naturally, then ask what they want to call the token. Keep it casual and short.`;
      break;
    case "symbol": {
      const suggestions = generateTickerSuggestions(name);
      const sugList = suggestions.map(s => `$${s}`).join(", ");
      stepInstruction = `The user just set the token name to "${name}". Acknowledge their choice with enthusiasm, then ask what ticker symbol they want. Suggest these options: ${sugList} — but let them know they can pick their own. Keep it to 2-3 sentences.`;
      break;
    }
    case "supply":
      stepInstruction = `The user just set the symbol to $${symbol}. Acknowledge it, then ask how many tokens should exist at launch. Briefly explain the tradeoffs: small supply (10k or less) = scarce and collectible, medium (around 1M) = balanced for most projects, large (100M+) = accessible and great for tipping or meme tokens. Give a couple of real examples. Ask them for a number. Keep it conversational, not a bulleted list.`;
      break;
    case "description":
      stepInstruction = `The user set the supply to ${parseInt(supply).toLocaleString()} $${symbol}. Acknowledge it naturally, then ask what this token is for. Tell them to just give a rough idea — you'll help write a proper description. One or two sentences max.`;
      break;
    case "features":
      // Features step is handled by template (too structured for LLM)
      stepInstruction = "";
      break;
    case "done":
      stepInstruction = "";
      break;
  }

  if (!stepInstruction) return [];

  return [
    { role: "system", content: `${TOKEN_SYSTEM_BASE}${contextBlock}\n${stepInstruction}` },
    { role: "user", content: userMessage },
  ];
}

async function generateLLMDescription(
  userHint: string,
  name: string,
  symbol: string,
  category: string,
): Promise<string | null> {
  const sym = symbol.toUpperCase();
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You are writing a short token description for a listing page on the Tonkl privacy blockchain. Write exactly ONE paragraph (2-3 sentences). The token is called "${name}" ($${sym}), categorized as "${category}". The user described it as: "${userHint}". Write a professional but approachable description that captures what makes this token unique. Mention Tonkl and privacy-preserving transfers naturally. Do NOT use markdown, bullet points, or bold text. Do NOT start with "Introducing" or "Welcome to". Just write the description directly.`,
    },
    {
      role: "user",
      content: `Write a token description for ${name} ($${sym}) based on this: ${userHint}`,
    },
  ];
  return callTokenLLM(messages);
}

// ─── Token creation: LLM steering helpers ───────────────────

type MergedForm = Record<string, unknown>;

function getNextMissingField(merged: MergedForm): string {
  if (!merged.name) return "name";
  if (!merged.symbol) return "symbol";
  const supply = String(merged.initialSupply || "");
  if (!supply || supply === "0") return "supply";
  const desc = String(merged.description || "");
  if (!desc || desc.length < 10) return "description";
  // After description, present tokenomics/features before final preview
  // _askedAdvanced is set by buildTokenCreationReply when features are presented
  if (!merged._askedAdvanced) return "features";
  return "done";
}

// ─── Token creation conversational replies ────────────────────

type TokenFormState = Record<string, unknown>;

function buildTokenCreationReply(
  extracted: TokenFields,
  currentForm?: TokenFormState,
): string {
  // Merge current form state with newly extracted fields to see what we have
  const merged = { ...(currentForm || {}), ...extracted };
  const hasName = Boolean(merged.name);
  const hasSymbol = Boolean(merged.symbol);
  const hasSupply = Boolean(merged.initialSupply) && String(merged.initialSupply) !== "0";
  const hasDescription = Boolean(merged.description) && String(merged.description).length >= 10;

  // ── Step 1: No name yet ──────────────────────────────────
  if (!hasName && !extracted.name) {
    return "Let's create your token. What do you want to call it?";
  }

  // ── Step 2: Need a ticker symbol ─────────────────────────
  if (hasName && !hasSymbol && !extracted.symbol) {
    const name = String(merged.name);
    const suggestions = generateTickerSuggestions(name);
    const sugList = suggestions.map(s => `$${s}`).join(", ");
    return `"${name}" — got it. What ticker symbol do you want? Some ideas: ${sugList} — or pick your own.`;
  }

  // ── Step 3: Need supply ──────────────────────────────────
  if (hasName && hasSymbol && !hasSupply && !extracted.initialSupply) {
    const symbol = String(merged.symbol).toUpperCase();
    return `$${symbol} locked in. How many tokens should exist at launch? Here's a breakdown:\n\n` +
      `• 10,000 or less — Scarce and collectible. Each token feels valuable. Great for membership passes or premium access. Think limited seats at a table.\n\n` +
      `• 1,000,000 — The sweet spot. Enough liquidity for trading, but each token still feels meaningful. Works for most utility and governance tokens.\n\n` +
      `• 100M to 1B+ — High volume, low unit price. Feels accessible — people like holding "millions" of something. Perfect for tipping, micro-rewards, or meme tokens.\n\n` +
      `No wrong answer — it depends on how you want $${symbol} to feel. Just give me a number or say something like "10 million".`;
  }

  // ── Step 4: Need description ─────────────────────────────
  if (hasName && hasSymbol && hasSupply && !hasDescription && !extracted.description) {
    const supply = parseInt(String(merged.initialSupply)).toLocaleString();
    const symbol = String(merged.symbol).toUpperCase();
    return `${supply} $${symbol} — locked in. Now tell me what this token is for — just a rough idea and I'll help you write a proper description.`;
  }

  // ── Step 5: Description received → polish it + present features ──
  if (hasName && hasSymbol && hasSupply && hasDescription && !merged._askedAdvanced) {
    const symbol = String(merged.symbol).toUpperCase();
    const description = String(merged.description);
    const name = String(merged.name);

    // Auto-infer category from the description
    const inferredCategory = inferCategoryFromDescription(description, name);
    const categoryDisplay = CATEGORY_DISPLAY[inferredCategory] || "Utility";
    extracted.category = categoryDisplay;

    // Generate or polish the description — if the user was vague, write a proper one;
    // if they gave detail, clean it up and make it professional
    const polished = polishDescription(description, name, symbol, inferredCategory);
    extracted.description = polished;

    // Mark features as presented so next round goes to "done"
    extracted._askedAdvanced = true; // reuse this field to signal _featuresPresented

    const parts: string[] = [];

    // Present the AI-written description
    parts.push(`Here's a description I've written for $${symbol}:\n\n"${polished}"\n\nYou can edit this in the preview card or tell me to rewrite it.`);

    // Category-aware acknowledgment
    const categoryIntros: Record<string, string> = {
      impact: `I've categorised this as an Impact token — it'll show up under social good / charity projects.`,
      community: `Tagged as a Community token — great for social and fan-driven projects.`,
      governance: `This is a Governance token — tagged for DAO and voting discovery.`,
      meme: `Meme token energy detected — tagged as Meme.`,
      gaming: `Tagged as a Gaming token — players will find it easily.`,
      stablecoin: `Tagged as a Stablecoin — stability-focused discovery.`,
      rwa: `Tagged as RWA — real-world asset backed.`,
      utility: `Tagged as a Utility token.`,
    };
    parts.push(categoryIntros[inferredCategory] || categoryIntros.utility);

    // Present Tonkl-specific on-chain features
    parts.push(`\nTonkl lets you bake tokenomics directly into the protocol. Here are the features available:`);

    // Suggest features based on category
    const featureSuggestions: string[] = [];
    if (inferredCategory === "impact" || inferredCategory === "community") {
      featureSuggestions.push(`• Echo (recommended for ${categoryDisplay}) — redirects a % of every transfer to a designated wallet (treasury, charity fund, etc). I'd suggest 1%.`);
      extracted.echoRate = "100"; // 100 bps = 1% default
    } else {
      featureSuggestions.push(`• Echo — redirects a % of every transfer to a designated wallet (treasury, rewards pool, etc).`);
    }

    if (inferredCategory === "meme") {
      featureSuggestions.push(`• Burn (recommended for Meme) — permanently destroys a % of every transfer. Makes supply deflationary. I'd suggest 2%.`);
      extracted.burnRate = "200"; // 200 bps = 2% default
    } else {
      featureSuggestions.push(`• Burn — permanently destroys a % of every transfer. Makes supply deflationary over time.`);
    }

    featureSuggestions.push(`• Supply Cap — hard maximum that can never be exceeded, even by future minting.`);

    parts.push(featureSuggestions.join("\n"));

    // Show what's been auto-set
    const autoSet: string[] = [];
    if (extracted.echoRate && extracted.echoRate !== "0") autoSet.push(`1% echo`);
    if (extracted.burnRate && extracted.burnRate !== "0") autoSet.push(`2% burn`);
    if (autoSet.length > 0) {
      parts.push(`\nI've auto-set ${autoSet.join(" and ")} based on the token type. Say "looks good" to continue with the preview, or tell me to change/remove anything.`);
    } else {
      parts.push(`\nWant me to enable any of these? Or say "looks good" to continue to the preview.`);
    }

    return parts.join("\n");
  }

  // ── Step 6: All done — show final summary with preview ──
  if (hasName && hasSymbol && hasSupply && hasDescription && merged._askedAdvanced) {
    const symbol = String(merged.symbol).toUpperCase();
    const name = String(merged.name);
    const supply = parseInt(String(merged.initialSupply)).toLocaleString();
    const category = String(merged.category || "Utility");

    const parts: string[] = [];
    parts.push(`Here's your $${symbol} preview:`);
    parts.push(`• ${name} ($${symbol}) · ${category}`);
    parts.push(`• ${supply} tokens`);
    if (merged.burnRate && String(merged.burnRate) !== "0") {
      parts.push(`• ${(parseInt(String(merged.burnRate)) / 100).toFixed(1)}% burn per transfer`);
    }
    if (merged.echoRate && String(merged.echoRate) !== "0") {
      parts.push(`• ${(parseInt(String(merged.echoRate)) / 100).toFixed(1)}% echo redistribution`);
    }
    parts.push(`\nYou can upload a logo in the preview card, or edit any details. Hit "Create Token" when you're ready — the ZK proof takes about 30-60 seconds.`);

    return parts.join("\n");
  }

  // ── Fallback ─────────────────────────────────────────────
  const parts: string[] = [];
  if (Object.keys(extracted).length > 0) {
    const items: string[] = [];
    if (extracted.name) items.push(`name "${extracted.name}"`);
    if (extracted.symbol) items.push(`$${extracted.symbol}`);
    if (extracted.initialSupply) items.push(`${parseInt(extracted.initialSupply).toLocaleString()} supply`);
    parts.push(`Got it — ${items.join(", ")}.`);
  }

  const missing: string[] = [];
  if (!hasName) missing.push("a name");
  if (!hasSymbol) missing.push("a ticker");
  if (!hasSupply) missing.push("supply amount");

  if (missing.length > 0) {
    parts.push(`Still need ${missing.join(" and ")}.`);
  }

  return parts.join(" ");
}

/**
 * Polish a raw user description into something presentable.
 * Capitalises, removes filler, adds the token name context.
 */
/**
 * Generate a proper token description from the user's raw input.
 *
 * If the user gave enough detail, clean it up and make it professional.
 * If the user was vague ("idk", "just a personal thing"), generate a
 * real description from context (name, category, keywords).
 */
function polishDescription(raw: string, name: string, symbol: string, category?: string): string {
  // ALWAYS generate a proper description from context.
  // The user's raw text is treated as a hint/brief — not the final copy.
  // This ensures even casual input like "its about my cat" produces a
  // professional token description.
  return generateDescriptionFromContext(name, symbol, category || "utility", raw.trim());
}

/**
 * Generate a meaningful description from context when the user was vague,
 * or enhance their rough idea into a proper token description.
 *
 * Uses the inferred category, token name, and any keywords from the user's
 * input to write something that sounds like it belongs on a token listing.
 */
function generateDescriptionFromContext(name: string, symbol: string, category: string, hint: string): string {
  const sym = symbol.toUpperCase();
  const cat = category.toLowerCase();
  const hintLower = hint.toLowerCase();

  // ── Try to extract the "subject" from the hint ──────────
  // "a reflection of my cat tummy" → "cat tummy"
  // "helping kids learn to read" → "helping kids learn to read"
  // "just my personal thing" → personal
  const subjectMatch = hint.match(/(?:reflection\s+of|tribute\s+to|inspired\s+by|based\s+on|about|for|tied\s+to|linked\s+to|part\s+of|connected\s+to)\s+(?:my\s+|our\s+|the\s+|a\s+)?(.+)/i);
  const subject = subjectMatch ? subjectMatch[1].trim() : "";

  // ── Detect specific themes in the hint ──────────────────
  const hasAnimal = /\b(cat|dog|puppy|kitten|hamster|frog|fish|bird|turtle|bunny|pet)\b/i.test(hintLower);
  const hasFood = /\b(pizza|taco|burger|ramen|cookie|cake|banana|tendies)\b/i.test(hintLower);
  const hasPersonal = /\b(personal|my\s+own|creator|myself|me)\b/i.test(hintLower);
  const hasCommunity = /\b(community|fan|follower|support|audience|people)\b/i.test(hintLower);
  const hasReward = /\b(reward|earn|incentiv|loyal|exclusive|access|perk|benefit)\b/i.test(hintLower);
  const hasCharity = /\b(charit|donat|cause|help|impact|fund|educat|school|climate|environment|health)\b/i.test(hintLower);
  const hasGame = /\b(game|play|quest|level|score|earn.*play)\b/i.test(hintLower);
  const hasMascot = /\b(mascot|emblem|symbol|represent|identity|brand)\b/i.test(hintLower);
  const hasPrivacy = /\b(privacy|private|anonymous|encrypted|confidential|secret|hidden)\b/i.test(hintLower);
  const hasService = hint.match(/\b(?:service|app|platform|product|protocol|network|messaging|chat)\s+(?:called|named)?\s*([A-Za-z][A-Za-z0-9 ]*)/i);
  const serviceName = hasService ? hasService[1]?.trim() : "";

  // ── MEME descriptions — match the energy ────────────────
  if (cat === "meme") {
    if (hasAnimal && subject) {
      return `${name} ($${sym}) is a meme token inspired by ${subject}. No roadmap, no promises — just pure ${subject} energy on the Tonkl network. Hold $${sym} and join the cult.`;
    }
    if (hasAnimal) {
      const animal = hintLower.match(/\b(cat|dog|puppy|kitten|hamster|frog|fish|bird|turtle|bunny)\b/i)?.[1] || "pet";
      return `${name} ($${sym}) is a ${animal}-themed meme token on Tonkl. Community-driven, privacy-first, and powered by pure ${animal} energy. Every trade is a tribute.`;
    }
    if (hasFood) {
      const food = hintLower.match(/\b(pizza|taco|burger|ramen|cookie|cake|banana|tendies)\b/i)?.[1] || "food";
      return `${name} ($${sym}) — the official ${food} token of the Tonkl network. Deflationary, delicious, and completely unnecessary. Hold it because you can.`;
    }
    if (subject) {
      return `${name} ($${sym}) is a meme token born from ${subject}. No utility, no apologies — just vibes and privacy-first transactions on Tonkl.`;
    }
    return `${name} ($${sym}) is a community-driven meme token on the Tonkl network. No roadmap needed — just vibes, privacy, and deflationary tokenomics. The culture is the utility.`;
  }

  // ── IMPACT descriptions ─────────────────────────────────
  if (cat === "impact" || hasCharity) {
    if (subject) {
      return `${name} ($${sym}) is an impact token dedicated to ${subject}. A portion of every transaction is redirected to support the cause, with privacy-preserving transfers ensuring donor confidentiality on the Tonkl network.`;
    }
    return `${name} ($${sym}) is an impact token designed to drive positive change. Every transaction channels funds toward the project's mission — with full on-chain accountability and privacy-preserving transfers on Tonkl.`;
  }

  // ── COMMUNITY descriptions ──────────────────────────────
  if (cat === "community" || hasCommunity || hasReward || hasMascot) {
    if (hasMascot && serviceName) {
      const sameAsName = serviceName.toLowerCase() === name.toLowerCase();
      const privacyClause = hasPrivacy ? "Built for a privacy-first ecosystem, every" : "Every";
      if (sameAsName) {
        return `${name} ($${sym}) is the official mascot token for the ${name} ecosystem on the Tonkl network. ${privacyClause} transfer is encrypted and programmable tokenomics are baked in from day one.`;
      }
      return `${name} ($${sym}) is the mascot token for ${serviceName} on the Tonkl network. ${privacyClause} transfer is encrypted and programmable tokenomics are baked in from day one.`;
    }
    if (hasMascot && subject) {
      return `${name} ($${sym}) is a mascot token representing ${subject} on the Tonkl network. It brings the community together around a shared identity — with privacy-first transfers and on-chain tokenomics.`;
    }
    if (subject && serviceName) {
      return `${name} ($${sym}) is the community token for ${serviceName} on the Tonkl network. Holders get a stake in the ecosystem — with privacy-preserving transfers and programmable tokenomics built in.`;
    }
    if (hasPersonal) {
      return `${name} ($${sym}) is a personal creator token on the Tonkl network. Supporters hold $${sym} to back the creator directly, unlock exclusive perks, and be part of the inner circle — with on-chain privacy and programmable tokenomics.`;
    }
    if (subject) {
      return `${name} ($${sym}) is a community token built around ${subject}. Holders unlock exclusive benefits and help shape the project's future — all on Tonkl's privacy-first network.`;
    }
    return `${name} ($${sym}) is a community token that rewards early supporters and active participants. Holders unlock exclusive benefits and help shape the project's future — all on Tonkl's privacy-first network.`;
  }

  // ── GAMING descriptions ─────────────────────────────────
  if (cat === "gaming" || hasGame) {
    return `${name} ($${sym}) powers in-game economies with privacy-preserving transactions. Players earn, trade, and spend $${sym} without exposing their game activity or wallet balances.`;
  }

  // ── GOVERNANCE descriptions ─────────────────────────────
  if (cat === "governance") {
    return `${name} ($${sym}) gives holders a direct vote in the project's future. Proposals, votes, and treasury decisions are tracked on-chain — with Tonkl's privacy layer keeping individual voting choices confidential.`;
  }

  // ── STABLECOIN descriptions ─────────────────────────────
  if (cat === "stablecoin") {
    return `${name} ($${sym}) is a stablecoin on the Tonkl network, maintaining a steady value while preserving full transaction privacy. Ideal for payments, savings, and DeFi without volatility.`;
  }

  // ── RWA descriptions ────────────────────────────────────
  if (cat === "rwa") {
    return `${name} ($${sym}) tokenises real-world assets on the Tonkl network. Ownership and transfers happen on-chain with privacy-preserving verification — bridging physical value to the decentralised world.`;
  }

  // ── PERSONAL (utility fallback) ─────────────────────────
  if (hasPersonal) {
    return `${name} ($${sym}) is a personal token on the Tonkl network. It represents the creator's vision and gives holders a direct connection — with privacy-preserving transfers and programmable on-chain mechanics.`;
  }

  // ── UTILITY (default) ───────────────────────────────────
  if (serviceName) {
    return `${name} ($${sym}) is a utility token powering ${serviceName} on the Tonkl network. It drives access, participation, and value exchange — with privacy-preserving transfers built into every interaction.`;
  }
  if (subject) {
    return `${name} ($${sym}) is a utility token built around ${subject}. It powers access, participation, and value exchange within its ecosystem — with privacy-preserving transfers on the Tonkl network.`;
  }
  return `${name} ($${sym}) is a utility token on the Tonkl network. It powers access, transactions, and participation within its ecosystem — with privacy-preserving transfers built into every interaction.`;
}

/**
 * Infer a category from the token description and name using contextual understanding.
 *
 * This goes beyond keyword matching — it reads the *intent* behind what the user said.
 * "a reflection of my cat tummy" → meme (pets/animals/silly = meme energy)
 * "helping kids in rural schools" → impact (helping/supporting people = impact)
 * "earn points for playing" → gaming (earning through activity = gaming)
 */
function inferCategoryFromDescription(description: string, name: string): string {
  const text = `${name} ${description}`.toLowerCase();

  // ── Explicit keywords (highest confidence) ──────────────
  if (/\b(?:meme|meme\s*coin|shitcoin|degen)\b/.test(text)) return "meme";
  if (/\b(?:govern(?:ance)?|vote|voting|dao|proposal|council|delegate)\b/.test(text)) return "governance";
  if (/\b(?:stable\s*coin|pegged|usd\b|dollar|fiat)\b/.test(text)) return "stablecoin";
  if (/\b(?:rwa|real[\s-]*world[\s-]*asset)\b/.test(text)) return "rwa";

  // ── Contextual signals: MEME ────────────────────────────
  // Animals, pets, food, silly things, pop culture, absurdity = meme energy
  const memeSignals = [
    /\b(?:cat|dog|puppy|kitten|hamster|frog|ape|monkey|shiba|doge|pepe|bird|fish|turtle|bunny|bear|wolf|fox)\b/,
    /\b(?:tummy|belly|butt|paw|snoot|boop|bonk|sploot|chonk|floof|smol|thicc)\b/,
    /\b(?:pizza|taco|burger|ramen|tendies|banana|cookie|cake)\b/,
    /\b(?:moon|lambo|diamond\s+hands?|hodl|wen|wagmi|gm|ser|fren)\b/,
    /\b(?:funny|silly|joke|lol|lmao|vibe|vibes|chaos|absurd|random|weird|cursed|based)\b/,
    /\b(?:reflection\s+of|tribute\s+to|inspired\s+by|dedicated\s+to)\s+(?:my\s+)?(?:cat|dog|pet|hamster)\b/,
    /\b(?:just\s+for\s+(?:fun|laughs|vibes)|no\s+reason|why\s+not|because\s+i\s+can)\b/,
  ];
  if (memeSignals.filter(p => p.test(text)).length >= 1) return "meme";

  // ── Contextual signals: IMPACT ──────────────────────────
  // Helping, giving, causes, education, environment, health = impact
  const impactSignals = [
    /\b(?:charity|charit(?:able|ies)|donate|donation|philanthrop)/,
    /\b(?:help(?:ing)?|support(?:ing)?|fund(?:ing)?|rais(?:e|ing))\s+(?:for\s+)?(?:people|children|kids|communities|families|education|schools|health|the\s+poor|refugees)/,
    /\b(?:climate|environment|carbon|green|sustain|renewable|clean\s+(?:water|energy|air))/,
    /\b(?:education|school|learning|teach|literacy|scholarship)/,
    /\b(?:hunger|poverty|homeless|shelter|disaster|relief|rescue|aid)\b/,
    /\b(?:hospital|medical|healthcare|mental\s+health|therapy|cure|disease)/,
    /\b(?:social\s+good|social\s+impact|make\s+(?:a\s+)?(?:the\s+)?(?:world|difference)|change\s+(?:the\s+)?(?:world|lives))/,
    /\b(?:non[\s-]*profit|ngo|foundation|cause|mission|empower)/,
    /\b(?:across\s+the\s+globe|worldwide|global|developing\s+(?:countries|nations|world))/,
  ];
  if (impactSignals.filter(p => p.test(text)).length >= 1) return "impact";

  // ── Contextual signals: COMMUNITY ───────────────────────
  // Fans, followers, creators, support, membership = community
  const communitySignals = [
    /\b(?:community|fan(?:s|base)?|follower|supporter|member(?:ship)?|tribe|squad|crew)\b/,
    /\b(?:creator|influencer|streamer|artist|musician|content)\b/,
    /\b(?:exclusive|access|perks?|benefits?|rewards?|loyalty|vip)\b/,
    /\b(?:my\s+(?:followers|fans|audience|supporters|community|people))\b/,
    /\b(?:back\s+me|support\s+me|join\s+(?:me|us)|come\s+together)\b/,
    /\b(?:personal\s+(?:token|brand|project)|my\s+own\s+token)\b/,
    /\b(?:mascot|represent(?:s|ing)?|emblem|symbol\s+(?:of|for)|identity|branding)\b/,
    /\b(?:tied\s+to|linked\s+to|associated\s+with|part\s+of)\s+(?:our|my|the|a)\b/,
  ];
  if (communitySignals.filter(p => p.test(text)).length >= 2) return "community";
  // Single strong community signal
  if (/\b(?:my\s+(?:followers|fans|audience)|personal\s+token|creator\s+token)\b/.test(text)) return "community";

  // ── Contextual signals: GAMING ──────────────────────────
  const gamingSignals = [
    /\b(?:game|gaming|gamer|play(?:er|ers|ing)?|esport)/,
    /\b(?:quest|level|xp|exp(?:erience)?|loot|inventory|crafting|spawn)/,
    /\b(?:in[\s-]*game|p2e|play[\s-]*to[\s-]*earn|earn\s+(?:by|while|through)\s+play)/,
    /\b(?:nft|avatar|skin|weapon|armor|guild|clan|raid|boss|pvp|pve)\b/,
    /\b(?:score|leaderboard|rank|achievement|unlock|power[\s-]*up)\b/,
  ];
  if (gamingSignals.filter(p => p.test(text)).length >= 1) return "gaming";

  // ── Contextual signals: GOVERNANCE ──────────────────────
  const govSignals = [
    /\b(?:decision|decide|choose|elect|represent)/,
    /\b(?:treasury|budget|allocat|fund\s+(?:management|allocation))/,
    /\b(?:stakeholder|shareholder|board|committee)/,
  ];
  if (govSignals.filter(p => p.test(text)).length >= 1) return "governance";

  // ── Contextual signals: STABLECOIN ──────────────────────
  if (/\b(?:stable|fixed\s+(?:price|value)|backed\s+by|reserve|collateral|peg(?:ged)?)\b/.test(text)) return "stablecoin";

  // ── Contextual signals: RWA ─────────────────────────────
  if (/\b(?:property|real[\s-]*estate|house|building|land|rental|commodity|gold|silver|oil|stock|equity|bond|share)\b/.test(text)) return "rwa";

  // ── Weak community signal (single match) ────────────────
  if (communitySignals.filter(p => p.test(text)).length >= 1) return "community";

  // ── Weak utility signals ────────────────────────────────
  if (/\b(?:utility|service|platform|api|access|tool|infra|protocol|pay(?:ment)?|transaction|fee)\b/.test(text)) return "utility";

  // ── Name-based heuristics (last resort) ─────────────────
  // If the token name itself is an animal, food, or silly word → probably meme
  const nameLower = name.toLowerCase().replace(/[^a-z]/g, "");
  const memeNames = /^(cat|dog|doge|shib|pepe|frog|moon|inu|floki|bonk|wojak|chad|mog|popcat|brett|toshi|neiro|turbo|pnut|goat|bome|wif|tremp|hawk|tuah|tummy|belly|chonk)$/;
  if (memeNames.test(nameLower)) return "meme";

  return "utility"; // safe default
}

/**
 * Generate 3–4 ticker suggestions from a token name.
 * Uses first letters, abbreviations, and creative combos.
 * Handles short single-word names like "abc" by generating variants.
 */
function generateTickerSuggestions(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const suggestions: string[] = [];
  const firstWord = words[0].toUpperCase().replace(/[^A-Z]/g, "");

  // The exact name uppercased (if it's short enough to be a ticker itself)
  if (firstWord.length >= 2 && firstWord.length <= 5) {
    suggestions.push(firstWord);
  }

  // First letters of each word (e.g. "Alpha Gold" → "AG")
  if (words.length >= 2) {
    const initials = words.map(w => w[0].toUpperCase()).join("");
    if (initials.length >= 2 && initials.length <= 5 && !suggestions.includes(initials)) {
      suggestions.push(initials);
    }
  }

  // First 3-4 chars of first word (e.g. "AlphaGold" → "ALPH")
  if (firstWord.length >= 4) {
    const s4 = firstWord.slice(0, 4);
    if (!suggestions.includes(s4)) suggestions.push(s4);
  }
  if (firstWord.length >= 3) {
    const s3 = firstWord.slice(0, 3);
    if (!suggestions.includes(s3)) suggestions.push(s3);
  }

  // First word initial + second word start (e.g. "Alpha Gold" → "AGLD")
  if (words.length >= 2) {
    const w2 = words[1].toUpperCase().replace(/[^A-Z]/g, "");
    if (w2.length >= 3) {
      const combo = words[0][0].toUpperCase() + w2.slice(0, 3);
      if (!suggestions.includes(combo)) suggestions.push(combo);
    }
  }

  // For short names, generate creative variants so there's always 3+ options
  if (suggestions.length < 3 && firstWord.length <= 4) {
    // Doubled last letter (e.g. "ABC" → "ABCC") — crypto style
    const doubled = firstWord + firstWord[firstWord.length - 1];
    if (doubled.length <= 5 && !suggestions.includes(doubled)) suggestions.push(doubled);
    // Add "X" suffix (e.g. "ABC" → "ABCX")
    const xSuffix = firstWord + "X";
    if (xSuffix.length <= 5 && !suggestions.includes(xSuffix)) suggestions.push(xSuffix);
    // Reversed (e.g. "ABC" → "CBA")
    const reversed = firstWord.split("").reverse().join("");
    if (reversed !== firstWord && reversed.length <= 5 && !suggestions.includes(reversed)) suggestions.push(reversed);
  }

  // Deduplicate and cap at 4
  return [...new Set(suggestions)].slice(0, 4);
}

// ─── Exit intent detection ───────────────────────────────────

function isExitingTokenCreation(message: string): boolean {
  const lower = message.toLowerCase();
  const exitPatterns = [
    /\b(?:changed?\s+my\s+mind|never\s*mind|forget\s+(?:it|the\s+token|about)|cancel|stop\s+(?:creating|the\s+token)|don'?t\s+want\s+(?:to\s+create|the\s+token)|skip\s+(?:it|the\s+token|that))\b/,
    /\b(?:instead|actually)\b.*\b(?:want\s+to|let'?s|can\s+(?:you|i|we))\b/,
    /\bi\s+(?:want\s+to|wanna|need\s+to)\s+(?:stake|send|receive|transfer|check|see|view|swap)\b/,
  ];
  return exitPatterns.some((p) => p.test(lower));
}

// ─── Token field extraction ───────────────────────────────────

type TokenFields = {
  symbol?: string;
  name?: string;
  description?: string;
  category?: string;
  initialSupply?: string;
  decimals?: number;
  burnRate?: string;
  echoRate?: string;
  supplyCap?: string;
  _askedAdvanced?: boolean;
};

const VALID_CATEGORIES = new Set([
  "utility", "governance", "meme", "stablecoin",
  "impact", "community", "gaming", "rwa", "other",
]);

const CATEGORY_DISPLAY: Record<string, string> = {
  utility: "Utility", governance: "Governance", meme: "Meme",
  stablecoin: "Stablecoin", impact: "Impact", community: "Community",
  gaming: "Gaming", rwa: "RWA", other: "Other",
};

/**
 * Extract token creation fields from a natural language message.
 * Runs server-side so the frontend gets structured data even if
 * the LLM doesn't return extracted_fields in its response.
 */
function extractTokenFields(
  message: string,
  currentForm?: Record<string, unknown>,
): TokenFields {
  const fields: TokenFields = {};
  const text = message;

  // ── Symbol ────────────────────────────────────────────────
  const SYMBOL_STOPWORDS = new Set([
    "YES", "NO", "OK", "OKAY", "SURE", "FINE", "GOOD", "GREAT", "NICE",
    "COOL", "DONE", "SKIP", "NAH", "NOPE", "PASS", "THE", "FOR", "AND",
    "WORKS", "SOUNDS", "LETS", "THAT", "THIS", "WITH", "JUST", "USE",
    "AS", "IS", "IT", "MY", "OR", "BE", "TO", "OF", "IN", "ON", "AT",
    "HAVE", "HAS", "HAD", "DO", "DOES", "DID", "WILL", "CAN", "MAY",
    "SET", "GET", "PUT", "ADD", "NOT", "BUT", "HOW", "WHAT", "WHEN",
  ]);

  // HIGHEST PRIORITY: "$XYZ" anywhere in message — dollar sign is strongest signal
  const dollarMatch = text.match(/\$([A-Za-z][A-Za-z0-9]{0,9})\b/i);
  if (dollarMatch && !SYMBOL_STOPWORDS.has(dollarMatch[1].toUpperCase())) {
    fields.symbol = dollarMatch[1].toUpperCase();
  }

  // "ticker $JEM", "symbol $ABC", "ticker as $JEM", "symbol is $ABC"
  if (!fields.symbol) {
    const tickerDollarMatch = text.match(
      /\b(?:symbol|ticker)\s+(?:is\s+|=\s+|should\s+be\s+|will\s+be\s+|as\s+)?\$([A-Za-z][A-Za-z0-9]{0,9})\b/i
    );
    if (tickerDollarMatch && !SYMBOL_STOPWORDS.has(tickerDollarMatch[1].toUpperCase())) {
      fields.symbol = tickerDollarMatch[1].toUpperCase();
    }
  }

  // "symbol VIBE", "ticker TEST", "symbol is ABC" (no $ prefix)
  if (!fields.symbol) {
    const symbolMatch = text.match(
      /\b(?:symbol|ticker)\s+(?:is\s+|=\s+|should\s+be\s+|will\s+be\s+|as\s+)?([A-Za-z][A-Za-z0-9]{0,9})\b/i
    );
    if (symbolMatch && !SYMBOL_STOPWORDS.has(symbolMatch[1].toUpperCase())) {
      fields.symbol = symbolMatch[1].toUpperCase();
    }
  }

  // "XYZ for the ticker/symbol"
  if (!fields.symbol) {
    const reverseMatch = text.match(
      /\$?([A-Za-z][A-Za-z0-9]{0,9})\s+(?:for|as)\s+(?:the\s+)?(?:ticker|symbol)\b/i
    );
    if (reverseMatch && !SYMBOL_STOPWORDS.has(reverseMatch[1].toUpperCase())) {
      fields.symbol = reverseMatch[1].toUpperCase();
    }
  }

  // Bare symbol — "AGLD" or "xyz" alone in the symbol step
  if (!fields.symbol && currentForm?.name && !currentForm?.symbol) {
    const bare = text.trim().replace(/^\$/, "");
    const bareSymbolMatch = bare.match(/^([A-Za-z][A-Za-z0-9]{1,9})$/i);
    if (bareSymbolMatch && !SYMBOL_STOPWORDS.has(bareSymbolMatch[1].toUpperCase())) {
      fields.symbol = bareSymbolMatch[1].toUpperCase();
    }
  }

  // ── Name ──────────────────────────────────────────────────
  // "called Vibe Token", "named Cool Coin", "token name is ..."
  const nameMatch = text.match(
    /\b(?:called?|named?|name(?:\s+is)?|call\s+(?:it|the\s+token))\s+([A-Za-z][A-Za-z0-9 _-]{0,62}?)(?=\s+(?:with|symbol|ticker|supply|decimals?|and)\b|[.,!?]|$)/i
  );
  if (nameMatch) {
    fields.name = nameMatch[1].trim();
  }

  // Bare name — if user just types "AlphaGold" or "Sunrise Token" in the name step
  // Only match when we don't already have a name and nothing else was extracted
  if (!fields.name && !currentForm?.name && !fields.symbol) {
    const bare = text.trim();
    // Match 1-4 words, capitalized or mixed case, no special chars beyond spaces/hyphens
    const bareNameMatch = bare.match(/^([A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*){0,3})$/i);
    const fillerWords = /^(yes|no|ok|okay|sure|yeah|yep|nah|nope|hi|hey|hello|thanks|thank|please|help|idk|maybe|hmm|lol|wow|cool|nice|great|good|fine|skip|next|go|start|done|cancel|stop|back|reset|quit)$/i;
    if (bareNameMatch && bare.length >= 2 && bare.length <= 64 && !fillerWords.test(bare)) {
      fields.name = bareNameMatch[1].trim();
    }
  }

  // ── Supply ────────────────────────────────────────────────
  // "10 million supply", "supply of 1000000", "mint 5000", "with 1m supply"
  // Handle "million", "billion", "k" suffixes
  const supplyPatterns = [
    /\b(?:initial\s+)?supply\s+(?:of\s+|is\s+|=\s+)?(\d+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\b/i,
    /\b(\d+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\s+(?:initial\s+)?supply\b/i,
    /\bmint\s+(\d+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\b/i,
    /\bwith\s+(\d+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\s+(?:tokens?|supply|coins?)?\b/i,
    // Bare number — for guided flow where user just types "1000000" or "10 million" or "1 billion please"
    /^[\s]*(\d[\d,]*(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?[\s]*$/i,
    /^[\s]*(\d[\d,]*(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\s+(?:tokens?|coins?)?[\s]*$/i,
    // Number + magnitude suffix anywhere in text (e.g. "1 billion please", "let's do 500 million")
    /\b(\d[\d,]*(?:\.\d+)?)\s*(million|mil|billion|bil|thousand)\b/i,
  ];
  for (const pattern of supplyPatterns) {
    const match = text.match(pattern);
    if (match) {
      let val = parseFloat(match[1]);
      const suffix = (match[2] || "").toLowerCase();
      if (suffix.startsWith("m")) val *= 1_000_000;
      else if (suffix.startsWith("b")) val *= 1_000_000_000;
      else if (suffix === "k" || suffix === "thousand") val *= 1_000;
      fields.initialSupply = String(Math.round(val));
      break;
    }
  }

  // ── Decimals ──────────────────────────────────────────────
  const decimalsMatch = text.match(
    /\bdecimals?\s+(?:is\s+|are\s+|=\s+|should\s+be\s+)?(\d{1,2})\b/i
  );
  if (decimalsMatch) {
    const d = parseInt(decimalsMatch[1]);
    if ([0, 2, 6, 8, 18].includes(d)) {
      fields.decimals = d;
    }
  }

  // ── Category ──────────────────────────────────────────────
  // Check for category keywords in the message
  const categoryPatterns: [RegExp, string][] = [
    [/\b(?:meme|meme\s*coin|shitcoin|degen)\b/i, "meme"],
    [/\b(?:governance|voting|dao)\b/i, "governance"],
    [/\b(?:stablecoin|stable\s*coin|pegged)\b/i, "stablecoin"],
    [/\b(?:community|social|fan)\b/i, "community"],
    [/\b(?:gaming|game|in-game|play-to-earn|p2e)\b/i, "gaming"],
    [/\b(?:utility|service|platform)\b/i, "utility"],
    [/\b(?:impact|charity|climate|social\s+good|donation)\b/i, "impact"],
    [/\b(?:rwa|real[\s-]*world[\s-]*asset)\b/i, "rwa"],
  ];
  for (const [pattern, cat] of categoryPatterns) {
    if (pattern.test(text)) {
      fields.category = CATEGORY_DISPLAY[cat] || cat;
      break;
    }
  }
  // Also check "category is X"
  const catExplicit = text.match(
    /\bcategory\s+(?:is\s+|=\s+|should\s+be\s+)?(\w+)\b/i
  );
  if (catExplicit && VALID_CATEGORIES.has(catExplicit[1].toLowerCase())) {
    fields.category = CATEGORY_DISPLAY[catExplicit[1].toLowerCase()];
  }

  // ── Burn rate ─────────────────────────────────────────────
  const burnMatch = text.match(
    /\b(?:burn\s*(?:rate)?)\s+(?:of\s+|is\s+|=\s+)?(\d+(?:\.\d+)?)\s*(%|percent|bps|basis)?\b/i
  );
  if (burnMatch) {
    let val = parseFloat(burnMatch[1]);
    const unit = (burnMatch[2] || "").toLowerCase();
    // Convert percentage to basis points if needed
    if (unit === "%" || unit === "percent") val = Math.round(val * 100);
    fields.burnRate = String(Math.round(val));
  }

  // ── Echo / charity rate ───────────────────────────────────
  const echoMatch = text.match(
    /\b(?:echo|charity)\s*(?:rate)?\s+(?:of\s+|is\s+|=\s+)?(\d+(?:\.\d+)?)\s*(%|percent|bps|basis)?\b/i
  );
  if (echoMatch) {
    let val = parseFloat(echoMatch[1]);
    const unit = (echoMatch[2] || "").toLowerCase();
    if (unit === "%" || unit === "percent") val = Math.round(val * 100);
    fields.echoRate = String(Math.round(val));
  }

  // ── Supply cap ────────────────────────────────────────────
  const capPatterns = [
    /\b(?:supply\s*)?cap\s+(?:of\s+|is\s+|=\s+|at\s+)?(\d+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\b/i,
    /\bmax(?:imum)?\s+(?:supply\s+)?(?:of\s+|is\s+|=\s+)?(\d+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\b/i,
  ];
  for (const pattern of capPatterns) {
    const match = text.match(pattern);
    if (match) {
      let val = parseFloat(match[1]);
      const suffix = (match[2] || "").toLowerCase();
      if (suffix.startsWith("m")) val *= 1_000_000;
      else if (suffix.startsWith("b")) val *= 1_000_000_000;
      else if (suffix === "k" || suffix === "thousand") val *= 1_000;
      fields.supplyCap = String(Math.round(val));
      break;
    }
  }

  // ── Infer symbol from name if not explicit ────────────────
  if (!fields.symbol && fields.name && !currentForm?.symbol) {
    // If name is short enough and all caps, treat as symbol
    const nameUpper = fields.name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (nameUpper.length <= 10 && fields.name === fields.name.toUpperCase()) {
      fields.symbol = nameUpper;
    }
  }

  // ── Description from "for ..." or "to ..." clauses ───────
  const descMatch = text.match(
    /\bfor\s+((?:rewarding|tracking|powering|funding|supporting|building|creating|managing|enabling)\s+[^.!?]{10,150})/i
  );
  if (descMatch) {
    fields.description = descMatch[1].trim();
  }

  // Bare description — if user just types a sentence in the description step
  // Only match when we have name + symbol + supply but no description yet
  if (!fields.description && currentForm?.name && currentForm?.symbol && currentForm?.initialSupply &&
      !currentForm?.description) {
    const bare = text.trim();
    // Accept any sentence-like text >=10 chars that isn't a single word or number
    if (bare.length >= 10 && bare.length <= 500 && /\s/.test(bare) &&
        !/^\d+\s*(million|mil|m|billion|bil|b|thousand|k)?$/i.test(bare)) {
      fields.description = bare;
    }
  }

  // ── Feature modifications: "remove burn" / "no echo" / "add 3% burn" / etc ──
  // These can happen at any point during token creation
  if (currentForm?.name) {
    // "remove burn", "no burn", "disable burn", "0 burn"
    if (/\b(?:remove|no|disable|drop|skip|without)\s*burn\b/i.test(text)) {
      fields.burnRate = "0";
    }
    // "remove echo", "no echo", "disable echo"
    if (/\b(?:remove|no|disable|drop|skip|without)\s*echo\b/i.test(text)) {
      fields.echoRate = "0";
    }
  }

  return fields;
}
