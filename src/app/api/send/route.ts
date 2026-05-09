/**
 * Send / Transfer API
 *
 * Executes a shielded transfer by spawning the wallet CLI's `send` command,
 * which handles note selection, witness building, ZK proof generation
 * (nargo execute + bb prove), and transaction submission.
 *
 * POST /api/send {
 *   amount: 100,
 *   recipientAddress: "0xabc...",   // pk_x hex (64 chars)
 *   assetId?: "1",                  // default: TNKL
 *   passphrase?: "..."             // if wallet is encrypted
 * }
 *
 * Security:
 *  - Rate limited: 5 per IP per minute
 *  - Concurrent limit: 1 (proving is heavy)
 *  - 120s timeout (proof generation can take 30-60s)
 *  - Passphrase never logged
 *  - Only the wallet send command is run (no injection)
 */

import { spawn } from "node:child_process";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

const NODE_URL =
  process.env.TONKL_NODE_URL || process.env.OBSCURA_NODE_URL || "http://127.0.0.1:9100";
const WALLET_SCRIPT =
  process.env.TONKL_WALLET_SCRIPT || process.env.OBSCURA_WALLET_SCRIPT || "";
const WALLET_DB =
  process.env.TONKL_WALLET_DB || process.env.OBSCURA_WALLET_DB || "";
const PYTHON = process.env.TONKL_PYTHON || process.env.OBSCURA_PYTHON || "python3";

const RATE_LIMIT = { max: 5, windowMs: 60_000 };
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes — proof gen is slow
const MAX_BODY_SIZE = 2 * 1024;
const MAX_CONCURRENT = 1; // Only one proof at a time

let activeTransfers = 0;

const ADDRESS_PATTERN = /^(0x)?[0-9a-fA-F]{1,64}$/;

type SendRequest = {
  amount?: number;
  recipientAddress?: string;
  recipientPkY?: string;
  assetId?: string;
  passphrase?: string;
};

export async function POST(request: Request) {
  // ── Session auth ────────────────────────────────────────────
  const authFailed = requireSession(request);
  if (authFailed) return authFailed;

  // ── Rate limit ──────────────────────────────────────────────
  const clientKey = getClientKey(request);
  const limited = checkRateLimit("send", clientKey, RATE_LIMIT);
  if (limited) return limited;

  // ── Body size ───────────────────────────────────────────────
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return Response.json(
      { error: "payload_too_large", message: "Request too large." },
      { status: 413 }
    );
  }

  // ── Wallet must be configured ───────────────────────────────
  if (!WALLET_SCRIPT) {
    return Response.json(
      { error: "not_configured", message: "Wallet is not configured." },
      { status: 503 }
    );
  }

  // ── Parse body ──────────────────────────────────────────────
  let body: SendRequest;
  try {
    body = (await request.json()) as SendRequest;
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Could not parse request." },
      { status: 400 }
    );
  }

  // ── Validate amount ─────────────────────────────────────────
  const amount = body.amount;
  if (!amount || typeof amount !== "number" || amount <= 0 || !Number.isInteger(amount)) {
    return Response.json(
      { error: "invalid_amount", message: "Amount must be a positive integer." },
      { status: 400 }
    );
  }

  if (amount > 1_000_000_000) {
    return Response.json(
      { error: "amount_too_large", message: "Amount exceeds maximum." },
      { status: 400 }
    );
  }

  // ── Validate recipient ──────────────────────────────────────
  const recipient = typeof body.recipientAddress === "string"
    ? body.recipientAddress.trim()
    : "";

  if (!recipient || !ADDRESS_PATTERN.test(recipient)) {
    return Response.json(
      { error: "invalid_recipient", message: "Recipient must be a valid hex address." },
      { status: 400 }
    );
  }

  // ── Validate asset ID ───────────────────────────────────────
  const assetId = body.assetId || "1";
  if (!/^\d{1,4}$/.test(assetId)) {
    return Response.json(
      { error: "invalid_asset", message: "Asset ID must be a number." },
      { status: 400 }
    );
  }

  // ── Concurrent limit ────────────────────────────────────────
  if (activeTransfers >= MAX_CONCURRENT) {
    return Response.json(
      { error: "server_busy", message: "A transfer is already in progress. ZK proofs take time — please wait." },
      { status: 503 }
    );
  }

  // ── Resolve recipient pk_x and pk_y ──────────────────────────
  const ensure0x = (s: string) => s && !s.startsWith("0x") ? `0x${s}` : s;
  let toPkX = ensure0x(recipient);
  let toPkY = "";

  // Look up pk_y — check if recipient matches one of our own keys
  try {
    const keysOutput = await runListKeys(body.passphrase);
    const keysResult = JSON.parse(keysOutput);
    if (keysResult.keys) {
      const norm = (s: string) => (s || "").replace(/^0x/i, "").toLowerCase();
      const match = keysResult.keys.find(
        (k: { pk_x?: string }) => norm(k.pk_x || "") === norm(recipient)
      );
      if (match) {
        toPkX = ensure0x(match.pk_x || "");
        toPkY = ensure0x(match.pk_y || "");
      }
    }
  } catch {
    // Not critical
  }

  if (!toPkY) {
    return Response.json(
      { error: "missing_pk_y", message: "Could not resolve recipient public key. For alpha testnet, you can send to your own address (from the Receive page)." },
      { status: 400 }
    );
  }

  // ── Execute send ────────────────────────────────────────────
  try {
    const output = await runSend(amount, toPkX, toPkY, assetId, body.passphrase);

    // Try to extract tx hash from output
    const txHash = extractTxHash(output);

    return Response.json({
      success: true,
      message: `Sent ${amount} ${assetId === "1" ? "TNKL" : "tokens"} to ${toPkX.slice(0, 10)}...`,
      txHash,
      output: sanitizeOutput(output),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (process.env.NODE_ENV !== "production") {
      console.error("[send] Error:", msg.slice(0, 500));
    }

    if (msg.includes("insufficient") || msg.includes("Insufficient")) {
      return Response.json(
        { error: "insufficient_balance", message: "Insufficient balance for this transfer." },
        { status: 400 }
      );
    }

    return Response.json(
      { error: "send_failed", message: "Transfer failed. The node may be offline or proof generation failed." },
      { status: 500 }
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function runListKeys(passphrase?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [WALLET_SCRIPT, "--node-url", NODE_URL];
    if (WALLET_DB) args.push("--db", WALLET_DB);
    // SECURITY: Pass passphrase via stdin to avoid ps visibility
    if (passphrase) args.push("--passphrase-stdin");
    args.push("--json", "list-keys");

    const safeEnv: NodeJS.ProcessEnv = {
      PATH: `${process.env.NARGO_PATH || ""}:${process.env.PATH || "/usr/bin:/usr/local/bin"}`.replace(/^:/, ""),
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
    };
    if (process.env.PYTHONPATH) safeEnv.PYTHONPATH = process.env.PYTHONPATH;
    if (process.env.VIRTUAL_ENV) safeEnv.VIRTUAL_ENV = process.env.VIRTUAL_ENV;

    const child = spawn(PYTHON, args, {
      stdio: [passphrase ? "pipe" : "ignore", "pipe", "pipe"] as const,
      env: safeEnv,
    });

    // Write passphrase to stdin if provided
    if (passphrase && child.stdin) {
      child.stdin.write(passphrase + "\n");
      child.stdin.end();
    }

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 16_384) stdout += chunk;
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("list-keys timed out"));
    }, 15_000);

    child.on("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error("list-keys failed"));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function runSend(
  amount: number,
  toPkX: string,
  toPkY: string,
  assetId: string,
  passphrase?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    activeTransfers++;

    const args = [WALLET_SCRIPT, "--node-url", NODE_URL];
    if (WALLET_DB) args.push("--db", WALLET_DB);
    // SECURITY: Pass passphrase via stdin to avoid ps visibility
    if (passphrase) args.push("--passphrase-stdin");
    args.push("send", String(amount), "--to-pk-x", toPkX, "--to-pk-y", toPkY);
    if (assetId !== "1") args.push("--asset-id", assetId);

    const safeEnv: NodeJS.ProcessEnv = {
      PATH: `${process.env.NARGO_PATH || ""}:${process.env.PATH || "/usr/bin:/usr/local/bin"}`.replace(/^:/, ""),
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
    };
    if (process.env.PYTHONPATH) safeEnv.PYTHONPATH = process.env.PYTHONPATH;
    if (process.env.VIRTUAL_ENV) safeEnv.VIRTUAL_ENV = process.env.VIRTUAL_ENV;

    const child = spawn(PYTHON, args, {
      stdio: [passphrase ? "pipe" : "ignore", "pipe", "pipe"] as const,
      env: safeEnv,
    });

    // Write passphrase to stdin if provided
    if (passphrase && child.stdin) {
      child.stdin.write(passphrase + "\n");
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      activeTransfers--;
      reject(new Error("Transfer timed out (proof generation may be slow)"));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 32_768) stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk;
    });

    child.on("error", (error: Error) => {
      clearTimeout(timeout);
      activeTransfers--;
      reject(error);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      activeTransfers--;
      if (code !== 0) {
        const combined = (stdout + "\n" + stderr).slice(0, 1500);
        if (process.env.NODE_ENV !== "production") {
          console.error(`[send] Failed (exit ${code}):`, combined.slice(0, 500));
        }
        reject(new Error(combined));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function extractTxHash(output: string): string | null {
  // Look for patterns like "TX hash: 0xabc..." or "tx_hash: 0xabc..."
  const match = output.match(/(?:TX|tx)[_ ]?hash[:\s]+([0-9a-fA-Fx]+)/i);
  return match ? match[1] : null;
}

function sanitizeOutput(output: string): string {
  // Remove any file paths or sensitive info from output before sending to client
  return output
    .replace(/\/[^\s]+\.(py|db|toml|json|gz)/g, "[path]")
    .replace(/0x[0-9a-fA-F]{64,}/g, (m) => m.slice(0, 10) + "...")
    .slice(0, 2048);
}
