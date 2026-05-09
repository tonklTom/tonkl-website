/**
 * Testnet Faucet API
 *
 * Dispenses testnet TNKL tokens to a given address.
 * Rate limited: 1 request per address per hour, 10 total per IP per hour.
 *
 * Usage:  POST /api/faucet { address: "obs1..." }
 */

import { spawn } from "node:child_process";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

const NODE_URL =
  process.env.TONKL_NODE_URL || process.env.OBSCURA_NODE_URL || "http://127.0.0.1:9100";
const WALLET_SCRIPT =
  process.env.TONKL_WALLET_SCRIPT || process.env.OBSCURA_WALLET_SCRIPT || "";
const PYTHON =
  process.env.TONKL_PYTHON || process.env.OBSCURA_PYTHON || "python3";
const WALLET_DB =
  process.env.TONKL_WALLET_DB || process.env.OBSCURA_WALLET_DB || "";
const FAUCET_AMOUNT = process.env.FAUCET_AMOUNT || "100";
const REQUEST_TIMEOUT_MS = 120_000; // Faucet TX takes longer (ZK proving)

// ─── Rate limits ────────────────────────────────────────────────
const IP_RATE_LIMIT = { max: 10, windowMs: 3_600_000 }; // 10 per IP per hour
const ADDR_RATE_LIMIT = { max: 1, windowMs: 3_600_000 }; // 1 per address per hour

// ─── Concurrent limit ───────────────────────────────────────────
const MAX_CONCURRENT = 2;
let activeDispenses = 0;

// ─── Address validation ─────────────────────────────────────────
// Tonkl addresses are hex public keys (64 hex chars)
const ADDRESS_PATTERN = /^[0-9a-fA-F]{64}$/;

export async function POST(request: Request) {
  // ── Session auth ────────────────────────────────────────────
  const authFailed = requireSession(request);
  if (authFailed) return authFailed;

  // ── Rate limit by IP ────────────────────────────────────────
  const clientKey = getClientKey(request);
  const ipLimited = checkRateLimit("faucet-ip", clientKey, IP_RATE_LIMIT);
  if (ipLimited) return ipLimited;

  // ── Check wallet is configured ──────────────────────────────
  if (!WALLET_SCRIPT) {
    return Response.json(
      { error: "not_configured", message: "Faucet is not available on this server." },
      { status: 503 }
    );
  }

  // ── Parse body ──────────────────────────────────────────────
  let body: { address?: string };
  try {
    body = (await request.json()) as { address?: string };
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Could not parse request." },
      { status: 400 }
    );
  }

  const address = typeof body.address === "string" ? body.address.trim() : "";

  // ── Validate address ────────────────────────────────────────
  if (!address) {
    return Response.json(
      { error: "missing_address", message: "Provide a wallet address." },
      { status: 400 }
    );
  }

  if (!ADDRESS_PATTERN.test(address)) {
    return Response.json(
      { error: "invalid_address", message: "Address must be a 64-character hex public key." },
      { status: 400 }
    );
  }

  // ── Rate limit by address ───────────────────────────────────
  const addrLimited = checkRateLimit("faucet-addr", address.toLowerCase(), ADDR_RATE_LIMIT);
  if (addrLimited) return addrLimited;

  // ── Concurrent limit ────────────────────────────────────────
  if (activeDispenses >= MAX_CONCURRENT) {
    return Response.json(
      { error: "server_busy", message: "Faucet is processing other requests. Try again in a moment." },
      { status: 503 }
    );
  }

  // ── Look up spending_sk from user's wallet ────────────────────
  // We use --to-sk so the faucet CLI can auto-import the received
  // note into the user's wallet. The sk stays server-side.
  let spendingSk = "";
  let displayAddr = address.slice(0, 8) + "..." + address.slice(-8);
  try {
    const keysOutput = await runWalletCommand(["--json", "list-keys"]);
    // SECURITY: Never log list-keys output — it contains spending_sk
    const keysResult = JSON.parse(keysOutput);
    if (keysResult.keys && keysResult.keys.length > 0) {
      const key = keysResult.keys[0];
      spendingSk = key.spending_sk || "";
      // Ensure 0x prefix
      if (spendingSk && !spendingSk.startsWith("0x")) {
        spendingSk = `0x${spendingSk}`;
      }
      const pkx = key.pk_x || "";
      displayAddr = pkx.slice(0, 10) + "..." + pkx.slice(-8);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[faucet] list-keys failed (details redacted)");
    }
  }

  if (!spendingSk) {
    return Response.json(
      { error: "missing_keys", message: "Could not find wallet keys. Make sure the wallet has derived keys." },
      { status: 400 }
    );
  }

  // ── Dispense tokens ─────────────────────────────────────────
  try {
    const result = await runFaucet(spendingSk, FAUCET_AMOUNT);
    return Response.json({
      success: true,
      message: `Sent ${FAUCET_AMOUNT} TNKL to ${displayAddr}`,
      amount: FAUCET_AMOUNT,
      output: result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (process.env.NODE_ENV !== "production") {
      console.error("[faucet] Error:", msg.slice(0, 500));
    }
    // Surface useful errors to the client
    if (msg.includes("insufficient") || msg.includes("balance")) {
      return Response.json(
        { error: "faucet_empty", message: "Faucet wallet has no tokens. The testnet may need to be restarted with genesis." },
        { status: 503 }
      );
    }
    if (msg.includes("Rate limited") || msg.includes("cooldown")) {
      return Response.json(
        { error: "cooldown", message: "You already received tokens recently. Try again later." },
        { status: 429 }
      );
    }
    return Response.json(
      { error: "faucet_error", message: "Failed to dispense tokens. The node may be offline or the faucet wallet may be empty." },
      { status: 500 }
    );
  }
}

export async function GET() {
  return Response.json({
    name: "Tonkl Testnet Faucet",
    amount: `${FAUCET_AMOUNT} TNKL`,
    limits: {
      perAddress: "1 request per hour",
      perIP: "10 requests per hour",
    },
    available: !!WALLET_SCRIPT,
  });
}

// ─── Helpers ────────────────────────────────────────────────────

function runWalletCommand(extraArgs: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [WALLET_SCRIPT, "--node-url", NODE_URL];
    if (WALLET_DB) args.push("--db", WALLET_DB);
    args.push(...extraArgs);

    const safeEnv: NodeJS.ProcessEnv = {
      PATH: `${process.env.NARGO_PATH || ""}:${process.env.PATH || "/usr/bin:/usr/local/bin"}`.replace(/^:/, ""),
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
    };
    if (process.env.PYTHONPATH) safeEnv.PYTHONPATH = process.env.PYTHONPATH;

    const child = spawn(PYTHON, args, {
      stdio: ["ignore", "pipe", "pipe"] as const,
      env: safeEnv,
    });

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 16_384) stdout += chunk;
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Command timed out"));
    }, 15_000);

    child.on("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stdout.slice(0, 1000)));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function runFaucet(toSk: string, amount: string): Promise<string> {
  return new Promise((resolve, reject) => {
    activeDispenses++;

    const args = [WALLET_SCRIPT, "--node-url", NODE_URL];
    if (WALLET_DB) args.push("--db", WALLET_DB);
    args.push("faucet", "--to-sk-env", "TONKL_FAUCET_SK", "--amount", amount, "--no-limit");

    // SECURITY: Pass spending key via env var, not CLI arg (CLI args are visible in ps)
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: `${process.env.NARGO_PATH || ""}:${process.env.PATH || "/usr/bin:/usr/local/bin"}`.replace(/^:/, ""),
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
      TONKL_FAUCET_SK: toSk,
    };
    if (process.env.PYTHONPATH) safeEnv.PYTHONPATH = process.env.PYTHONPATH;

    const child = spawn(PYTHON, args, {
      stdio: ["ignore", "pipe", "pipe"] as const,
      env: safeEnv,
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      activeDispenses--;
      reject(new Error("Faucet command timed out"));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 8192) stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk;
    });

    child.on("error", (error: Error) => {
      clearTimeout(timeout);
      activeDispenses--;
      reject(error);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      activeDispenses--;
      if (code !== 0) {
        const combined = (stdout + "\n" + stderr).slice(0, 1000);
        if (process.env.NODE_ENV !== "production") {
          console.error(`[faucet] Failed (exit ${code}):`, combined.slice(0, 500));
        }
        reject(new Error(combined));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
