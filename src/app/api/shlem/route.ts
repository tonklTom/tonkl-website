import { spawn } from "node:child_process";

export const runtime = "nodejs";

const DEFAULT_SHLEM_DIR = process.env.SHLEM_DIR || "";
const DEFAULT_NODE_URL = "http://127.0.0.1:9100";
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CONTENT_LENGTH = 1200;
const REQUEST_TIMEOUT_MS = 30_000;

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
    const history = parseHistory((body as { history?: unknown }).history);
    const payload = await runShlem(message, history);
    const summary = summarizeShlemPayload(payload);
    const response: ShlemApiResponse = {
      reply: formatShlemReply(payload),
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

function runShlem(message: string, history: ShlemHistoryTurn[]): Promise<ShlemPayload> {
  const shlemDir = process.env.SHLEM_DIR || DEFAULT_SHLEM_DIR;
  const python = process.env.SHLEM_PYTHON || "python3";
  const pythonPath = `${shlemDir}/src`;
  const nodeUrl = (
    process.env.SHLEM_NODE_URL
    || process.env.TONKL_NODE_URL
    || process.env.OBSCURA_NODE_URL
    || DEFAULT_NODE_URL
  );
  const walletCmd = buildWalletCommand(nodeUrl);
  const args = ["-m", "shlem.cli", message, "--json", "--node-url", nodeUrl];
  if (history.length > 0) {
    args.push("--history-json", JSON.stringify(history));
  }
  if (walletCmd) {
    args.push("--wallet-cmd", walletCmd);
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
    const child = spawn(
      python,
      args,
      {
        cwd: shlemDir,
        env: {
          ...process.env,
          SHLEM_NODE_URL: nodeUrl,
          ...(walletCmd ? { SHLEM_WALLET_CMD: walletCmd } : {}),
          PYTHONPATH: process.env.PYTHONPATH
            ? `${pythonPath}:${process.env.PYTHONPATH}`
            : pythonPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Shlem CLI timed out"));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

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

  const walletScript = process.env.TONKL_WALLET_SCRIPT || process.env.OBSCURA_WALLET_SCRIPT;
  if (!walletScript) {
    return undefined;
  }

  const command = [
    process.env.TONKL_PYTHON || process.env.OBSCURA_PYTHON || "python3",
    walletScript,
    "--node-url",
    nodeUrl,
    "--json",
  ];
  const walletDb = process.env.TONKL_WALLET_DB || process.env.OBSCURA_WALLET_DB;
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
