/**
 * Wallet Data API (Hardened)
 *
 * Invokes the Tonkl Python wallet CLI to get balance, notes, and history
 * for the configured wallet database. All key material stays server-side.
 *
 * Security measures:
 *  - Valid app session required for all wallet metadata
 *  - Strict command whitelist (read-only only)
 *  - Rate limiting per client IP (30 req/min)
 *  - Concurrent execution limit (max 3 wallet processes at once)
 *  - Minimal environment passed to child process (no secret leakage)
 *  - stderr sanitized — never leaks file paths or stack traces to client
 *  - Stdout buffer capped to prevent memory exhaustion
 *  - Request body size cap (2 KB)
 *
 * Usage:
 *   GET  /api/wallet              → full wallet summary (balance + notes + history)
 *   POST /api/wallet { command }  → run a specific wallet query
 */

import { spawn } from "node:child_process";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

const NODE_URL = process.env.TONKL_NODE_URL || "http://127.0.0.1:9100";
const WALLET_SCRIPT = process.env.TONKL_WALLET_SCRIPT || "";
const WALLET_DB = process.env.TONKL_WALLET_DB || "";
const PYTHON = process.env.TONKL_PYTHON || "python3";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_SIZE = 2 * 1024; // 2 KB
const MAX_STDOUT_SIZE = 512 * 1024; // 512 KB — cap stdout to prevent OOM

// ─── Rate limit: 30 requests per minute per IP ─────────────────
const RATE_LIMIT = { max: 30, windowMs: 60_000 };

// ─── Concurrent execution limit ────────────────────────────────
const MAX_CONCURRENT = 3;
let activeProcesses = 0;

// ─── Read-only command whitelist ────────────────────────────────
// SECURITY: Every command here must be read-only. Never add send,
// transfer, merge, split, mint, or any state-mutating command.
const SAFE_COMMANDS = new Set([
  "balance",
  "notes",
  "status",
  "history",
  "assets",
  "address",
  "scan",
  "sync",
  "validators",
  "stakes",
  "epoch-info",
  "validator-set",
  "reward-history",
]);

/**
 * GET /api/wallet — returns a combined wallet summary
 */
export async function GET(request: Request) {
  // Rate limit GET requests too
  const clientKey = getClientKey(request);
  const limited = checkRateLimit("wallet", clientKey, RATE_LIMIT);
  if (limited) return limited;

  const authFailed = requireSession(request);
  if (authFailed) return authFailed;

  // If wallet script isn't configured, return read-only node data only
  if (!WALLET_SCRIPT) {
    const nodeStatus = await fetchNodeStatus();
    return Response.json({
      connected: nodeStatus !== null,
      chain: nodeStatus,
      wallet: null,
    });
  }

  try {
    const nodeStatus = await fetchNodeStatus();

    let walletData: WalletSummary | null = null;
    try {
      walletData = await getWalletSummary();
    } catch {
      // Wallet may not be configured — that's okay
    }

    return Response.json({
      connected: nodeStatus !== null,
      chain: nodeStatus,
      wallet: walletData,
    });
  } catch {
    return Response.json({
      connected: false,
      chain: null,
      wallet: null,
      error: "Failed to fetch wallet data",
    });
  }
}

/**
 * POST /api/wallet — run a specific read-only wallet command
 */
export async function POST(request: Request) {
  // ── Rate limit ──────────────────────────────────────────────
  const clientKey = getClientKey(request);
  const limited = checkRateLimit("wallet", clientKey, RATE_LIMIT);
  if (limited) return limited;

  const authFailed = requireSession(request);
  if (authFailed) return authFailed;

  // ── Body size check ─────────────────────────────────────────
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return Response.json(
      { error: "payload_too_large", message: "Request body exceeds limit." },
      { status: 413 }
    );
  }

  // ── Wallet must be configured ───────────────────────────────
  if (!WALLET_SCRIPT) {
    return Response.json(
      { error: "not_configured", message: "Wallet is not configured on this server." },
      { status: 503 }
    );
  }

  // ── Parse body ──────────────────────────────────────────────
  let body: { command?: string };
  try {
    body = (await request.json()) as { command?: string };
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Could not parse request." },
      { status: 400 }
    );
  }

  // ── Validate command against whitelist ───────────────────────
  const command = typeof body.command === "string" ? body.command.trim() : "";

  if (!command || !SAFE_COMMANDS.has(command)) {
    // SECURITY: Don't echo the attempted command back (could be used for probing)
    return Response.json(
      { error: "invalid_command", message: "Command is not available." },
      { status: 403 }
    );
  }

  // ── Concurrent limit ────────────────────────────────────────
  if (activeProcesses >= MAX_CONCURRENT) {
    return Response.json(
      { error: "server_busy", message: "Too many wallet queries in progress. Try again shortly." },
      { status: 503 }
    );
  }

  // ── Execute ─────────────────────────────────────────────────
  try {
    if (command === "address") {
      const output = await getPublicAddressOutput();
      return Response.json({ command, output });
    }

    const output = await runWalletCommand(command);
    return Response.json({ command, output: redactWalletOutput(output) });
  } catch {
    // SECURITY: Never forward internal error details (stderr, file paths, etc.)
    return Response.json(
      { error: "wallet_error", message: "Wallet query failed. The node may be offline." },
      { status: 500 }
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────

type WalletSummary = {
  balance: string;
  balanceRaw: number;
  noteCount: number;
  assets: AssetBalance[];
};

type AssetBalance = {
  assetId: string;
  symbol: string;
  balance: string;
  balanceRaw: number;
};

async function fetchNodeStatus(): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(NODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "get_status",
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const body = await resp.json();
    return body.error ? null : (body.result as Record<string, unknown>);
  } catch {
    return null;
  }
}

async function getWalletSummary(): Promise<WalletSummary> {
  // Scan for incoming notes before checking balance
  try {
    await runWalletCommand("scan");
  } catch {
    // Scan might fail if no scan keys registered — that's okay
  }

  const balanceOutput = await runWalletCommand("balance");

  let totalRaw = 0;
  const assets: AssetBalance[] = [];

  // Parse JSON output from --json balance
  try {
    const parsed = JSON.parse(balanceOutput);
    if (parsed.balances) {
      const SYMBOLS: Record<string, string> = { "1": "TNKL", "4": "sUSDC" };
      for (const [assetId, info] of Object.entries(parsed.balances)) {
        const bal = info as { raw: number; formatted: string; asset: string };
        const symbol = SYMBOLS[assetId] || bal.asset || `Asset#${assetId}`;
        assets.push({
          assetId,
          symbol,
          balance: bal.formatted || String(bal.raw),
          balanceRaw: bal.raw,
        });
        if (assetId === "1") totalRaw = bal.raw;
      }
    }
  } catch {
    // Fallback: parse text output
    const lines = balanceOutput.split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*([\d,.]+)\s+(\w+)/);
      if (match) {
        const valStr = match[1].replace(/,/g, "");
        const val = parseFloat(valStr);
        const symbol = match[2];
        if (!isNaN(val)) {
          assets.push({
            assetId: symbol === "TNKL" ? "1" : symbol === "sUSDC" ? "4" : "?",
            symbol,
            balance: match[1],
            balanceRaw: val,
          });
          if (symbol === "TNKL") totalRaw = val;
        }
      }
    }
  }

  let noteCount = 0;
  try {
    const notesOutput = await runWalletCommand("notes");
    try {
      const parsed = JSON.parse(notesOutput);
      noteCount = parsed.count || (parsed.notes ? parsed.notes.length : 0);
    } catch {
      const noteLines = notesOutput
        .split("\n")
        .filter((l) => l.includes("note_id") || /^\s*\d+\s/.test(l));
      noteCount = noteLines.length;
    }
  } catch {
    // notes query might fail if no wallet
  }

  return {
    balance: totalRaw.toLocaleString(),
    balanceRaw: totalRaw,
    noteCount,
    assets,
  };
}

async function getPublicAddressOutput(): Promise<string> {
  const output = await runWalletCommand("list-keys");
  let parsed: { keys?: Array<{ index?: number; pk_x?: string; pk_y?: string }> };

  try {
    parsed = JSON.parse(output) as {
      keys?: Array<{ index?: number; pk_x?: string; pk_y?: string }>;
    };
  } catch {
    return JSON.stringify({ status: "ok", addresses: [] });
  }

  const addresses = (parsed.keys || [])
    .map((key) => ({
      index: typeof key.index === "number" ? key.index : 0,
      pk_x: typeof key.pk_x === "string" ? key.pk_x : "",
      pk_y: typeof key.pk_y === "string" ? key.pk_y : "",
    }))
    .filter((key) => key.pk_x && key.pk_y);

  return JSON.stringify({ status: "ok", addresses });
}

function redactWalletOutput(output: string): string {
  return output
    .replace(/"spending_sk"\s*:\s*"[^"]*"/gi, '"spending_sk":"[redacted]"')
    .replace(/"scan_sk"\s*:\s*"[^"]*"/gi, '"scan_sk":"[redacted]"')
    .replace(/"mnemonic"\s*:\s*"[^"]*"/gi, '"mnemonic":"[redacted]"')
    .replace(/Spending key \(sk\):\s*0x[0-9a-f]+/gi, "Spending key (sk): [redacted]")
    .replace(/Seed phrase:\s*.*/gi, "Seed phrase: [redacted]");
}

function runWalletCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Track concurrent processes
    activeProcesses++;

    const args = [WALLET_SCRIPT, "--node-url", NODE_URL];
    if (WALLET_DB) args.push("--db", WALLET_DB);
    // Always use --json for structured output when available
    args.push("--json", command);

    // SECURITY: Only pass the minimum required environment variables.
    // Never spread ...process.env — it would leak secrets, API keys, etc.
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: `${process.env.NARGO_PATH || ""}:${process.env.PATH || "/usr/bin:/usr/local/bin"}`.replace(/^:/, ""),
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
    };
    // Pass through Python-specific vars if set
    if (process.env.PYTHONPATH) safeEnv.PYTHONPATH = process.env.PYTHONPATH;
    if (process.env.VIRTUAL_ENV) safeEnv.VIRTUAL_ENV = process.env.VIRTUAL_ENV;
    if (process.env.TONKL_RPC_SECRET) safeEnv.TONKL_RPC_SECRET = process.env.TONKL_RPC_SECRET;

    const child = spawn(PYTHON, args, {
      stdio: ["ignore", "pipe", "pipe"] as const,
      env: safeEnv,
    });

    let stdout = "";
    let stdoutSize = 0;
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      activeProcesses--;
      reject(new Error("Wallet command timed out"));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutSize += chunk.length;
      if (stdoutSize <= MAX_STDOUT_SIZE) {
        stdout += chunk;
      } else {
        // Kill process if it's dumping too much output
        child.kill("SIGTERM");
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // Cap stderr capture too (we only use it for logging, never send to client)
      if (stderr.length < 4096) stderr += chunk;
    });

    child.on("error", (error: Error) => {
      clearTimeout(timeout);
      activeProcesses--;
      reject(error);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      activeProcesses--;
      if (code !== 0) {
        // SECURITY: Log stderr server-side but never send to client.
        // stderr may contain file paths, Python tracebacks, env vars, etc.
        if (stderr && process.env.NODE_ENV !== "production") {
          console.error(`[wallet] Command '${command}' failed:`, stderr.slice(0, 500));
        }
        reject(new Error(`Wallet command failed with exit code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}
