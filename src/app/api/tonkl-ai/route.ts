import { spawn } from "node:child_process";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { validateSession } from "@/lib/session";

export const runtime = "nodejs";

const DEFAULT_TONKL_AI_DIR = process.env.TONKL_AI_DIR || "/Users/ashleycole/Desktop/tonkl-ai";
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

      // Detect "skip" / "looks good" / "no thanks" to bypass advanced features
      const skipAdvanced = /\b(?:skip|no\s*thanks?|looks?\s*good|that'?s?\s*(?:it|all|fine|enough)|i'?m?\s*good|just\s*create|go\s*ahead|create\s*(?:it|now|the\s*token)|nah|nope|pass|done)\b/i.test(message);
      if (skipAdvanced && !currentForm?._askedAdvanced) {
        // Mark that advanced was offered and skipped
        extracted._askedAdvanced = true;
      }

      const hasExtracted = Object.keys(extracted).length > 0;

      if (hasExtracted) {
        if (!payload.execution) {
          payload.execution = { ok: true, message: "Fields extracted from conversation.", data: {} };
        }
        if (!payload.execution.data) {
          payload.execution.data = {} as TonklAIExecutionData;
        }
        (payload.execution.data as Record<string, unknown>).extracted_fields = extracted;
      }

      // Always generate a guided token creation reply when in token_creation context.
      // This ensures the step-by-step wizard drives the conversation regardless of
      // whether the LLM is available or what intent it detected.
      const guidedReply = buildTokenCreationReply(extracted, currentForm);
      payload.message = guidedReply;
      if (payload.model) {
        payload.model.text = guidedReply;
      }
      // Ensure intent reflects token creation for frontend handling
      if (!payload.intent || payload.intent === "unknown" || payload.intent === "help") {
        payload.intent = "create_token";
      }

      // After showing advanced features prompt, mark it so we don't ask again
      // Detect if the reply we just generated is the advanced features prompt
      if (guidedReply.includes("Tonkl supports some powerful on-chain features")) {
        if (!hasExtracted || !extracted._askedAdvanced) {
          // Inject _askedAdvanced into extracted fields so frontend stores it in form
          if (!payload.execution) {
            payload.execution = { ok: true, message: "Advanced features offered.", data: {} };
          }
          if (!payload.execution.data) {
            payload.execution.data = {} as TonklAIExecutionData;
          }
          const ef = (payload.execution.data as Record<string, unknown>).extracted_fields || {};
          (ef as Record<string, unknown>)._askedAdvanced = true;
          (payload.execution.data as Record<string, unknown>).extracted_fields = ef;
        }
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
  return [
    /\b(?:my|wallet|account)\s+(?:balance|balances|assets?|tokens?|notes?|history|transactions?|address)\b/,
    /\b(?:balance|balances|assets?|tokens?|notes?|history|transactions?)\b/,
    /\b(?:send|transfer|pay|receive|scan|sync|faucet|drip|stake|unstake)\b/,
    /\b(?:mint|deploy|create)\s+(?:a\s+)?token\b/,
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
  const hasCategory = Boolean(merged.category) && String(merged.category) !== "Utility"; // Utility is default
  const hasBurnRate = Boolean(merged.burnRate) && String(merged.burnRate) !== "0";
  const hasEchoRate = Boolean(merged.echoRate) && String(merged.echoRate) !== "0";
  const hasAdvancedConfig = hasBurnRate || hasEchoRate || hasCategory ||
    (merged.decimals !== undefined && merged.decimals !== 0) ||
    Boolean(merged.supplyCap);
  // Track whether we've already shown the advanced features prompt
  const askedAdvanced = Boolean(merged._askedAdvanced);

  // ── Step 1: No name yet — ask for the token name ──────────
  if (!hasName && !extracted.name) {
    return "Let's create a token together. First up — what would you like to call it? This is the full display name that people will see (e.g. AlphaGold, Sunrise Token, Pixel Points).";
  }

  // ── Step 2: Got a name, need a symbol (ticker) ────────────
  if (hasName && !hasSymbol && !extracted.symbol) {
    const name = String(merged.name);
    const suggestions = generateTickerSuggestions(name);
    const sugList = suggestions.map(s => `$${s}`).join(", ");
    return `Great name — "${name}"! Now let's pick a ticker symbol. This is the short identifier people will use to trade and reference your token (like $BTC or $ETH).\n\nBased on the name, here are some ideas: ${sugList}\n\nOr go with something completely different — what feels right?`;
  }

  // ── Step 3: Got name + symbol, need supply ────────────────
  if (hasName && hasSymbol && !hasSupply && !extracted.initialSupply) {
    const symbol = String(merged.symbol).toUpperCase();
    return `$${symbol} — nice choice. Now for the initial supply. This is how many tokens will exist when you launch.\n\nHere's a quick guide:\n• 1,000 – 10,000 → scarce, collectible feel (think rare membership passes)\n• 100,000 – 1,000,000 → balanced, good for most utility or community tokens\n• 10,000,000+ → high supply, lower unit price feel (common for meme or gaming tokens)\n\nYou can always mint more later if needed. How many $${symbol} tokens do you want to start with?`;
  }

  // ── Step 4: Got essentials, need description ──────────────
  if (hasName && hasSymbol && hasSupply && !hasDescription && !extracted.description) {
    const supply = parseInt(String(merged.initialSupply)).toLocaleString();
    return `${supply} tokens — got it. Now give me a short description of what ${merged.name} is for. Just a sentence or two, like "A loyalty token for my coffee shop" or "Community governance for our DAO." This helps other users understand what your token represents.`;
  }

  // ── Step 5: Got basics, offer advanced features ───────────
  // Only show this once — if user hasn't configured any advanced features
  // and we haven't already asked
  if (hasName && hasSymbol && hasSupply && hasDescription && !hasAdvancedConfig && !askedAdvanced) {
    const category = inferCategoryFromDescription(String(merged.description), String(merged.name));
    const suggestions = suggestAdvancedFeatures(category, String(merged.description));

    if (suggestions.length > 0) {
      const symbol = String(merged.symbol).toUpperCase();
      let reply = `Nice — $${symbol} is shaping up. Before we finalize, Tonkl supports some powerful on-chain features you might want to configure:\n\n`;

      reply += suggestions.join("\n\n");

      reply += `\n\nYou can set any of these now — for example, "add a 2% burn rate" or "set echo to 1%, category governance." Or just say "skip" or "looks good" to create the token as-is.`;
      return reply;
    }
  }

  // ── All essentials collected — show summary ───────────────
  if (hasName && hasSymbol && hasSupply) {
    const parts: string[] = [];
    const symbol = String(merged.symbol).toUpperCase();

    // Acknowledge what was just provided
    if (extracted.name) parts.push(`Name set to "${extracted.name}".`);
    if (extracted.symbol) parts.push(`Ticker is $${symbol}.`);
    if (extracted.initialSupply) parts.push(`Supply: ${parseInt(extracted.initialSupply).toLocaleString()} tokens.`);
    if (extracted.description) parts.push(`Description noted.`);
    if (extracted.category) parts.push(`Category: ${extracted.category}.`);
    if (extracted.decimals !== undefined) parts.push(`Decimals: ${extracted.decimals}.`);
    if (extracted.burnRate) parts.push(`Burn rate: ${extracted.burnRate} bps.`);
    if (extracted.echoRate) parts.push(`Echo rate: ${extracted.echoRate} bps.`);

    // Build summary of what's configured
    const config: string[] = [];
    config.push(`Name: ${merged.name}`);
    config.push(`Ticker: $${symbol}`);
    config.push(`Supply: ${parseInt(String(merged.initialSupply)).toLocaleString()}`);
    if (hasCategory) config.push(`Category: ${merged.category}`);
    if (hasBurnRate) config.push(`Burn rate: ${merged.burnRate} bps (${(parseInt(String(merged.burnRate)) / 100).toFixed(2)}% per transfer)`);
    if (hasEchoRate) config.push(`Echo rate: ${merged.echoRate} bps (${(parseInt(String(merged.echoRate)) / 100).toFixed(2)}% redistributed)`);
    if (merged.supplyCap) config.push(`Supply cap: ${parseInt(String(merged.supplyCap)).toLocaleString()}`);
    if (merged.decimals && merged.decimals !== 0) config.push(`Decimals: ${merged.decimals}`);

    parts.push(`\nHere's your $${symbol} summary:\n${config.map(c => `• ${c}`).join("\n")}`);

    parts.push(
      `\nHit "Create Token" below to mint it on-chain. The ZK proof takes about 30-60 seconds to generate. You can also edit any details in the preview card, or tell me if you want to change something.`
    );

    return parts.join(" ");
  }

  // ── Fallback: acknowledge whatever was extracted ───────────
  const parts: string[] = [];
  if (Object.keys(extracted).length > 0) {
    const items: string[] = [];
    if (extracted.name) items.push(`name "${extracted.name}"`);
    if (extracted.symbol) items.push(`symbol $${extracted.symbol}`);
    if (extracted.category) items.push(`category ${extracted.category}`);
    if (extracted.initialSupply) items.push(`supply of ${parseInt(extracted.initialSupply).toLocaleString()}`);
    if (extracted.decimals !== undefined) items.push(`${extracted.decimals} decimals`);
    if (extracted.burnRate) items.push(`burn rate of ${extracted.burnRate} bps`);
    if (extracted.echoRate) items.push(`echo rate of ${extracted.echoRate} bps`);
    parts.push(`Got it — ${items.join(", ")}.`);
  }

  const missing: string[] = [];
  if (!hasName) missing.push("a name");
  if (!hasSymbol) missing.push("a ticker symbol");
  if (!hasSupply) missing.push("the initial supply");

  if (missing.length > 0) {
    const last = missing.length > 1 ? missing.pop()! : null;
    const list = last ? `${missing.join(", ")}, and ${last}` : missing[0];
    parts.push(`I still need ${list} to proceed.`);
  }

  return parts.join(" ");
}

/**
 * Infer a category from the token description and name.
 */
function inferCategoryFromDescription(description: string, name: string): string {
  const text = `${name} ${description}`.toLowerCase();

  if (/\b(?:meme|funny|joke|degen|shitpost|pepe|doge|moon)\b/.test(text)) return "meme";
  if (/\b(?:govern|vote|voting|dao|proposal|council|delegate)\b/.test(text)) return "governance";
  if (/\b(?:stable|pegged|usd|dollar|fiat)\b/.test(text)) return "stablecoin";
  if (/\b(?:community|social|fan|membership|loyalty|reward)\b/.test(text)) return "community";
  if (/\b(?:game|gaming|play|quest|level|xp|loot|nft)\b/.test(text)) return "gaming";
  if (/\b(?:impact|charity|climate|donate|social\s*good|green|carbon|aid)\b/.test(text)) return "impact";
  if (/\b(?:real[\s-]*world|property|asset|commodity|gold|oil|rwa)\b/.test(text)) return "rwa";
  if (/\b(?:utility|service|platform|api|access|tool|infra)\b/.test(text)) return "utility";

  return "utility"; // default
}

/**
 * Suggest advanced token features based on the inferred category and description.
 * Returns an array of suggestion strings, each explaining a feature and why it fits.
 */
function suggestAdvancedFeatures(category: string, description: string): string[] {
  const suggestions: string[] = [];
  const lower = description.toLowerCase();

  // Echo (redistribution) — especially for community, impact, governance
  if (["community", "impact", "governance", "gaming"].includes(category)) {
    suggestions.push(
      `🔄 **Echo Rate** — Automatically redirect a % of every transfer to a designated address. Great for ${
        category === "impact" ? "funding causes with every transaction" :
        category === "governance" ? "feeding a DAO treasury on every trade" :
        category === "gaming" ? "pooling rewards for players" :
        "giving back to your community with every transfer"
      }. Set in basis points (e.g. 100 bps = 1%). Example: "echo rate 1%" or "echo 250 bps".`
    );
  }

  // Burn rate — especially for meme, community, deflationary concepts
  if (["meme", "community", "utility"].includes(category) || /\b(?:deflat|scarc|burn|rare)\b/.test(lower)) {
    suggestions.push(
      `🔥 **Burn Rate** — Destroy a % of tokens on every transfer, making the supply deflationary over time. ${
        category === "meme" ? "Classic meme tokenomics — the longer it trades, the rarer it gets." :
        "Creates scarcity pressure as the token gets used more."
      } Set in basis points (e.g. 200 bps = 2%). Example: "burn rate 2%" or "burn 50 bps".`
    );
  }

  // Supply cap
  if (!["meme"].includes(category)) {
    suggestions.push(
      `📊 **Supply Cap** — Set a hard maximum that can never be exceeded, even with future minting. Signals scarcity and trust. Example: "supply cap 10 million" or "cap at 1 billion".`
    );
  }

  // Category — always suggest if not set
  suggestions.push(
    `🏷️ **Category** — Tag your token so others can find it. Options: Utility, Governance, Meme, Stablecoin, Impact, Community, Gaming, RWA (real-world asset). ${
      category !== "utility" ? `Based on your description, "${category}" seems like a good fit.` :
      `Example: "category governance" or "this is a community token".`
    }`
  );

  // Decimals — for specific use cases
  if (["stablecoin", "rwa"].includes(category) || /\b(?:price|cent|dollar|fraction|divisib)\b/.test(lower)) {
    suggestions.push(
      `🔢 **Decimals** — Controls how finely divisible your token is. 0 = whole units only (good for memberships/votes), 2 = cent-level (like USD), 8 = highly divisible (like BTC), 18 = max precision. Default is 0. Example: "decimals 8" or "make it divisible to 2 decimal places".`
    );
  }

  return suggestions;
}

/**
 * Generate 3–4 ticker suggestions from a token name.
 * Uses first letters, abbreviations, and creative combos.
 */
function generateTickerSuggestions(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const suggestions: string[] = [];

  // First letters of each word (e.g. "Alpha Gold" → "AG")
  if (words.length >= 2) {
    const initials = words.map(w => w[0].toUpperCase()).join("");
    if (initials.length >= 2 && initials.length <= 5) suggestions.push(initials);
  }

  // First 3-4 chars of first word (e.g. "AlphaGold" → "ALPH")
  const firstWord = words[0].toUpperCase().replace(/[^A-Z]/g, "");
  if (firstWord.length >= 4) suggestions.push(firstWord.slice(0, 4));
  if (firstWord.length >= 3 && !suggestions.includes(firstWord.slice(0, 3))) {
    suggestions.push(firstWord.slice(0, 3));
  }

  // First word initial + second word start (e.g. "Alpha Gold" → "AGLD")
  if (words.length >= 2) {
    const w2 = words[1].toUpperCase().replace(/[^A-Z]/g, "");
    if (w2.length >= 3) {
      const combo = words[0][0].toUpperCase() + w2.slice(0, 3);
      if (!suggestions.includes(combo)) suggestions.push(combo);
    }
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
  // "symbol VIBE", "ticker TEST", "symbol is ABC"
  const symbolMatch = text.match(
    /\b(?:symbol|ticker)\s+(?:is\s+|=\s+|should\s+be\s+|will\s+be\s+|as\s+)?([A-Za-z][A-Za-z0-9]{0,9})\b/i
  );
  if (symbolMatch) {
    fields.symbol = symbolMatch[1].toUpperCase();
  }

  // Bare symbol — if user just types "AGLD" or "$AGLD" in the symbol step
  // Only match when we already have a name but no symbol
  if (!fields.symbol && currentForm?.name && !currentForm?.symbol) {
    const bare = text.trim().replace(/^\$/, "");
    const bareSymbolMatch = bare.match(/^([A-Z][A-Z0-9]{1,9})$/);
    if (bareSymbolMatch) {
      fields.symbol = bareSymbolMatch[1];
    }
  }

  // ── Name ──────────────────────────────────────────────────
  // "called Vibe Token", "named Cool Coin", "token name is ..."
  const nameMatch = text.match(
    /\b(?:called|named|name(?:\s+is)?)\s+([A-Za-z][A-Za-z0-9 _-]{0,62}?)(?=\s+(?:with|symbol|ticker|supply|decimals?|and)\b|[.,!?]|$)/i
  );
  if (nameMatch) {
    fields.name = nameMatch[1].trim();
  }

  // Bare name — if user just types "AlphaGold" or "Sunrise Token" in the name step
  // Only match when we don't already have a name and nothing else was extracted
  if (!fields.name && !currentForm?.name && !fields.symbol) {
    const bare = text.trim();
    // Match 1-4 words, capitalized or mixed case, no special chars beyond spaces/hyphens
    const bareNameMatch = bare.match(/^([A-Z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*){0,3})$/);
    if (bareNameMatch && bare.length >= 2 && bare.length <= 64) {
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
    // Bare number — for guided flow where user just types "1000000" or "10 million"
    /^[\s]*(\d[\d,]*(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?[\s]*$/i,
    /^[\s]*(\d[\d,]*(?:\.\d+)?)\s*(million|mil|m|billion|bil|b|thousand|k)?\s+(?:tokens?|coins?)?[\s]*$/i,
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

  return fields;
}
