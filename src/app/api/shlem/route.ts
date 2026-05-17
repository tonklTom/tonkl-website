import { spawn } from "node:child_process";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { validateSession } from "@/lib/session";

export const runtime = "nodejs";

const DEFAULT_SHLEM_DIR = process.env.SHLEM_DIR || "";
const DEFAULT_NODE_URL = "http://127.0.0.1:9100";
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CONTENT_LENGTH = 1200;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_STDOUT_SIZE = 32_768; // Cap stdout to prevent memory exhaustion

// ─── Rate limit: 20 requests per minute per IP ──────────────────
const RATE_LIMIT = { max: 20, windowMs: 60_000 };

// ─── Concurrent execution limit ─────────────────────────────────
const MAX_CONCURRENT = 3;
let activeShlem = 0;

type ShlemHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

type ShlemPayload = {
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
    data?: ShlemExecutionData;
  } | null;
};

type ShlemExecutionData = {
  requires_confirmation?: boolean;
  execution_enabled?: boolean;
  preview?: ShlemPreview;
  json?: unknown;
  text?: string;
  error?: {
    suggestions?: string[];
  };
} & Record<string, unknown>;

type ShlemPreview = {
  preview_id: string;
  action: string;
  title: string;
  summary: string;
  fields: Record<string, string>;
  warnings: string[];
  confirmation_text: string;
  can_execute: boolean;
};

type ShlemResponseKind = "blocked" | "preview" | "error" | "read" | "message";

type ShlemResponseSummary = {
  kind: ShlemResponseKind;
  preview: ShlemPreview | null;
  requiresConfirmation: boolean;
  executionEnabled: boolean;
  modelStatus: "connected" | "fallback" | "disabled" | "skipped_blocked" | "unknown";
  modelName: string | null;
};

type ShlemApiResponse = {
  reply: string;
  payload: ShlemPayload;
} & ShlemResponseSummary;

type ShlemErrorResponse = {
  error: string;
  reply: string;
  detail?: string;
};

export async function POST(request: Request) {
  // ── Rate limit ──────────────────────────────────────────────
  const clientKey = getClientKey(request);
  const limited = checkRateLimit("shlem", clientKey, RATE_LIMIT);
  if (limited) return limited;

  // ── Concurrent limit ────────────────────────────────────────
  if (activeShlem >= MAX_CONCURRENT) {
    return Response.json(
      { error: "server_busy", reply: "Shlem is handling other requests. Try again in a moment." },
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
    return Response.json({ error: "empty_message", reply: "Send me a message to route through Shlem." }, { status: 400 });
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

    const payload = await runShlem(message, history, context, Boolean(session));

    // When in token_creation context, extract fields and override generic fallback replies
    // But first check if the user is exiting token creation
    const isExiting = context === "token_creation" && isExitingTokenCreation(message);
    if (context === "token_creation" && !isExiting) {
      const extracted = extractTokenFields(message, currentForm);
      const hasExtracted = Object.keys(extracted).length > 0;

      if (hasExtracted) {
        if (!payload.execution) {
          payload.execution = { ok: true, message: "Fields extracted from conversation.", data: {} };
        }
        if (!payload.execution.data) {
          payload.execution.data = {} as ShlemExecutionData;
        }
        (payload.execution.data as Record<string, unknown>).extracted_fields = extracted;
      }

      // Generate a contextual token creation reply when the LLM is unavailable
      // (fallback mode) — instead of the generic "unknown" response
      const isGenericFallback = !payload.model?.ok && (
        payload.intent === "unknown" ||
        payload.intent === "help" ||
        !payload.intent
      );

      if (isGenericFallback) {
        const reply = buildTokenCreationReply(extracted, currentForm);
        // Override the generic fallback message
        payload.message = reply;
        // Also override model text if it was a fallback
        if (payload.model) {
          payload.model.text = reply;
        }
      }
    }

    const summary = summarizeShlemPayload(payload);
    const response: ShlemApiResponse = {
      // In token_creation context with a custom reply, use the payload message
      reply: context === "token_creation" && payload.message && !payload.model?.ok
        ? payload.message
        : formatShlemReply(payload),
      payload,
      ...summary,
    };

    return Response.json(response);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown local Shlem bridge error";
    const response: ShlemErrorResponse = {
      error: "shlem_bridge_failed",
      reply: "I could not reach the local Shlem service. Make sure SHLEM_DIR is set in your .env.local and that Python can run the Shlem CLI.",
      detail,
    };

    return Response.json(
      response,
      { status: 500 }
    );
  }
}

function parseHistory(value: unknown): ShlemHistoryTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-MAX_HISTORY_TURNS)
    .flatMap((item): ShlemHistoryTurn[] => {
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
  return [
    /\b(?:my|wallet|account)\s+(?:balance|balances|assets?|tokens?|notes?|history|transactions?|address)\b/,
    /\b(?:balance|balances|assets?|tokens?|notes?|history|transactions?)\b/,
    /\b(?:send|transfer|pay|receive|scan|sync|faucet|drip|stake|unstake)\b/,
    /\b(?:mint|deploy|create)\s+(?:a\s+)?token\b/,
    /\b(?:use|read|check|show)\s+(?:my\s+)?(?:wallet|funds|transactions?|notes?)\b/,
  ].some((pattern) => pattern.test(lower));
}

function buildWalletSessionRequiredResponse(): ShlemApiResponse {
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
              "Then ask Shlem again and the request will include your wallet session.",
            ],
          },
        },
      },
    },
  };
}

function runShlem(
  message: string,
  history: ShlemHistoryTurn[],
  context?: string,
  allowWalletAccess = false,
): Promise<ShlemPayload> {
  const shlemDir = process.env.SHLEM_DIR || DEFAULT_SHLEM_DIR;
  const python = process.env.SHLEM_PYTHON || "python3";
  const pythonPath = `${shlemDir}/src`;
  const nodeUrl = (
    process.env.SHLEM_NODE_URL
    || process.env.TONKL_NODE_URL
   
    || DEFAULT_NODE_URL
  );
  const walletCmd = allowWalletAccess ? buildWalletCommand(nodeUrl) : undefined;
  const args = ["-m", "shlem.cli", message, "--json", "--node-url", nodeUrl];
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
  // LLM responses are now the default in Shlem CLI.
  // Pass --no-model only if explicitly disabled via env.
  if (shouldDisableModel()) {
    args.push("--no-model");
  }

  return new Promise((resolve, reject) => {
    activeShlem++;

    // SECURITY: Only pass minimum required env vars — never spread process.env
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH || "/usr/bin:/usr/local/bin",
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
      SHLEM_NODE_URL: nodeUrl,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${pythonPath}:${process.env.PYTHONPATH}`
        : pythonPath,
    };
    if (walletCmd) safeEnv.SHLEM_WALLET_CMD = walletCmd;
    if (process.env.VIRTUAL_ENV) safeEnv.VIRTUAL_ENV = process.env.VIRTUAL_ENV;
    if (process.env.NARGO_PATH) {
      safeEnv.PATH = `${process.env.NARGO_PATH}:${safeEnv.PATH}`;
    }

    const child = spawn(
      python,
      args,
      {
        cwd: shlemDir,
        env: safeEnv,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      activeShlem--;
      reject(new Error("Shlem CLI timed out"));
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
      activeShlem--;
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      activeShlem--;

      if (code !== 0) {
        reject(new Error(stderr.trim() || `Shlem CLI exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as ShlemPayload);
      } catch {
        reject(new Error("Shlem CLI returned non-JSON output"));
      }
    });
  });
}

function formatShlemReply(payload: ShlemPayload): string {
  if (payload.blocked) {
    return payload.message || "That request is blocked by Shlem's safety policy.";
  }

  if (payload.model?.ok && payload.model.text) {
    return payload.model.text;
  }

  const execution = payload.execution;
  if (!execution) {
    return payload.message || "Shlem prepared a response, but there was no execution context.";
  }

  const suggestions = execution.data?.error?.suggestions || [];
  const nextSteps = suggestions.length
    ? `\n\nNext steps:\n${suggestions.map((suggestion) => `- ${suggestion}`).join("\n")}`
    : "";
  const readData = execution.ok ? formatReadOnlyData(execution.data, payload.intent) : "";
  const readBlock = readData ? `\n\n${readData}` : "";

  return `${execution.message || payload.message || "Shlem completed the local route."}${readBlock}${nextSteps}`;
}

function summarizeShlemPayload(payload: ShlemPayload): ShlemResponseSummary {
  const execution = payload.execution;
  const preview = execution?.data?.preview || null;
  const requiresConfirmation = Boolean(
    preview || execution?.data?.requires_confirmation || payload.plan?.requires_confirmation
  );
  const executionEnabled = Boolean(execution?.data?.execution_enabled || preview?.can_execute);
  const modelStatus = (payload.model?.status || "unknown") as ShlemResponseSummary["modelStatus"];
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
  if (process.env.SHLEM_WALLET_CMD) {
    return process.env.SHLEM_WALLET_CMD;
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
  return ["1", "true", "yes"].includes((process.env.SHLEM_LEARN || "").toLowerCase());
}

function shouldDisableModel(): boolean {
  return ["1", "true", "yes"].includes((process.env.SHLEM_NO_MODEL || "").toLowerCase());
}

function quoteCommandPart(part: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(part)) {
    return part;
  }

  return `'${part.replaceAll("'", "'\"'\"'")}'`;
}

function formatReadOnlyData(data: ShlemExecutionData | undefined, intent?: string): string {
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

function formatBalanceData(data: ShlemExecutionData): string {
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

function readWalletJson(data: ShlemExecutionData): unknown {
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

// ─── Token creation conversational replies ────────────────────

type TokenFormState = Record<string, unknown>;

function buildTokenCreationReply(
  extracted: TokenFields,
  currentForm?: TokenFormState,
): string {
  // Merge current form state with newly extracted fields to see what we have
  const merged = { ...(currentForm || {}), ...extracted };
  const hasSymbol = Boolean(merged.symbol);
  const hasName = Boolean(merged.name);
  const hasSupply = Boolean(merged.initialSupply) && String(merged.initialSupply) !== "0";
  const hasDescription = Boolean(merged.description) && String(merged.description).length >= 10;

  const hasNew = Object.keys(extracted).length > 0;

  // Acknowledge what was just extracted
  const parts: string[] = [];
  if (hasNew) {
    const items: string[] = [];
    if (extracted.name) items.push(`name ${extracted.name}`);
    if (extracted.symbol) items.push(`symbol ${extracted.symbol}`);
    if (extracted.category) items.push(`category ${extracted.category}`);
    if (extracted.initialSupply) items.push(`supply of ${parseInt(extracted.initialSupply).toLocaleString()}`);
    if (extracted.decimals !== undefined) items.push(`${extracted.decimals} decimals`);
    if (extracted.burnRate) items.push(`burn rate of ${extracted.burnRate} bps`);
    if (extracted.echoRate) items.push(`echo rate of ${extracted.echoRate} bps`);
    parts.push(`Got it, ${items.join(", ")}.`);
  }

  // Ask for what's missing
  const missing: string[] = [];
  if (!hasSymbol) missing.push("a symbol (like VIBE or DAO)");
  if (!hasName) missing.push("a name for the token");
  if (!hasSupply) missing.push("the initial supply (how many tokens to mint)");
  if (!hasDescription) missing.push("a short description of what the token is for");

  if (missing.length === 0) {
    parts.push(
      `That covers the essentials. You can switch to the form to review everything and create the token, or tell me if you want to adjust anything like decimals, burn rate, or socials.`
    );
  } else if (missing.length === 1) {
    parts.push(`I still need ${missing[0]} to fill out the basics.`);
  } else {
    const last = missing.pop()!;
    parts.push(`I still need ${missing.join(", ")}, and ${last}.`);
  }

  return parts.join(" ");
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
  // "symbol VIBE", "ticker TEST", "symbol is ABC"
  const symbolMatch = text.match(
    /\b(?:symbol|ticker)\s+(?:is\s+|=\s+|should\s+be\s+|will\s+be\s+|as\s+)?([A-Za-z][A-Za-z0-9]{0,9})\b/i
  );
  if (symbolMatch) {
    fields.symbol = symbolMatch[1].toUpperCase();
  }

  // ── Name ──────────────────────────────────────────────────
  // "called Vibe Token", "named Cool Coin", "token name is ..."
  const nameMatch = text.match(
    /\b(?:called|named|name(?:\s+is)?)\s+([A-Za-z][A-Za-z0-9 _-]{0,62}?)(?=\s+(?:with|symbol|ticker|supply|decimals?|and)\b|[.,!?]|$)/i
  );
  if (nameMatch) {
    fields.name = nameMatch[1].trim();
  }

  // ── Supply ────────────────────────────────────────────────
  // "10 million supply", "supply of 1000000", "mint 5000", "with 1m supply"
  // Handle "million", "billion", "k" suffixes
  const supplyPatterns = [
    /\b(?:initial\s+)?supply\s+(?:of\s+|is\s+|=\s+)?(\d+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\b/i,
    /\b(\d+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\s+(?:initial\s+)?supply\b/i,
    /\bmint\s+(\d+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\b/i,
    /\bwith\s+(\d+(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\s+(?:tokens?|supply|coins?)?\b/i,
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

  return fields;
}
