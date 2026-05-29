/**
 * Testnet Faucet API
 *
 * Dispenses testnet TNKL tokens to a given address.
 * Rate limited: 1 request per address per hour, 10 total per IP per hour.
 *
 * Usage:  POST /api/faucet { address: "64-char hex pk_x" }
 */

import { spawn } from "node:child_process";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { validateSession } from "@/lib/session";

export const runtime = "nodejs";

const NODE_URL =
  process.env.TONKL_NODE_URL || "http://127.0.0.1:9100";
const WALLET_SCRIPT =
  process.env.TONKL_WALLET_SCRIPT || "";
const PYTHON =
  process.env.TONKL_PYTHON || "python3";
const WALLET_DB =
  process.env.TONKL_WALLET_DB || "";
const FAUCET_DB =
  process.env.TONKL_FAUCET_DB || "";
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
const ADDRESS_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;

type WalletKey = {
  index?: number;
  pk_x?: string;
  pk_y?: string;
};

type RecipientKey = {
  keyIndex: number;
  pkX: string;
  pkY: string;
  scanPk?: string;
};

export async function POST(request: Request) {
  // ── Session auth ────────────────────────────────────────────
  const session = validateSession(request);
  if (!session) {
    return Response.json(
      {
        error: "unauthorized",
        message: "Valid session required. Create or unlock a wallet first via /api/onboard.",
      },
      { status: 401 }
    );
  }

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
  const normalizedAddress = normalizeHex(address);

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

  const sessionAddress = normalizeHex(session.address);
  if (ADDRESS_PATTERN.test(session.address) && sessionAddress !== normalizedAddress) {
    return Response.json(
      { error: "address_mismatch", message: "Faucet requests must use the wallet address from the active session." },
      { status: 403 }
    );
  }

  // ── Rate limit by address ───────────────────────────────────
  const addrLimited = checkRateLimit("faucet-addr", normalizedAddress, ADDR_RATE_LIMIT);
  if (addrLimited) return addrLimited;

  // ── Concurrent limit ────────────────────────────────────────
  if (activeDispenses >= MAX_CONCURRENT) {
    return Response.json(
      { error: "server_busy", message: "Faucet is processing other requests. Try again in a moment." },
      { status: 503 }
    );
  }

  // ── Resolve the requested address to a local wallet key ──────
  // The route must not silently use the first key; the selected key
  // has to match the requested/session address.
  let recipientKey: RecipientKey | null = null;
  try {
    recipientKey = await resolveRecipientKey(normalizedAddress);
  } catch {
    if (process.env.NODE_ENV !== "production") {
      console.error("[faucet] list-keys failed (details redacted)");
    }
  }

  if (!recipientKey) {
    return Response.json(
      { error: "recipient_not_found", message: "Could not match that address to the active wallet. Use the address from Receive." },
      { status: 400 }
    );
  }

  // ── Sync faucet wallet before sending ────────────────────────
  try {
    await syncFaucetWallet();
  } catch {
    // Non-fatal — continue with send attempt
  }

  // ── Dispense tokens ─────────────────────────────────────────
  try {
    const result = await runFaucet(recipientKey.pkX, recipientKey.pkY, FAUCET_AMOUNT, recipientKey.scanPk);
    const displayAddr = recipientKey.pkX.slice(0, 10) + "..." + recipientKey.pkX.slice(-8);
    return Response.json({
      success: true,
      message: `Sent ${FAUCET_AMOUNT} TNKL to ${displayAddr}`,
      amount: FAUCET_AMOUNT,
      output: result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const lowered = msg.toLowerCase();
    if (process.env.NODE_ENV !== "production") {
      console.error("[faucet] Error:", msg.slice(0, 500));
    }
    // Surface useful errors to the client
    if (
      lowered.includes("tree_index") ||
      lowered.includes("node leaf count") ||
      lowered.includes("witness") ||
      lowered.includes("merkle")
    ) {
      return Response.json(
        {
          error: "faucet_state_mismatch",
          message: "Faucet wallet state is out of sync with the node. Sync or reset the faucet wallet for this testnet.",
        },
        { status: 503 }
      );
    }
    if (lowered.includes("cannot connect to node") || lowered.includes("node unreachable")) {
      return Response.json(
        { error: "node_unavailable", message: "Faucet could not reach the Tonkl node." },
        { status: 502 }
      );
    }
    if (lowered.includes("insufficient") || lowered.includes("faucet has insufficient")) {
      return Response.json(
        { error: "faucet_empty", message: "Faucet wallet has no tokens. The testnet may need to be restarted with genesis." },
        { status: 503 }
      );
    }
    if (lowered.includes("rate limited") || lowered.includes("cooldown")) {
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

function normalizeHex(value: string): string {
  return value.replace(/^0x/i, "").toLowerCase();
}

function ensure0x(value: string): string {
  return value.startsWith("0x") ? value : `0x${value}`;
}

async function resolveRecipientKey(address: string): Promise<RecipientKey | null> {
  // Query the USER's wallet to find pk_y for the given pk_x (address)
  const keysOutput = await runWalletCommand(["--json", "list-keys"], WALLET_DB);
  const keysResult = JSON.parse(keysOutput) as { keys?: WalletKey[] };

  const match = (keysResult.keys || []).find((key) => normalizeHex(key.pk_x || "") === address);
  if (typeof match?.index !== "number" || !match.pk_x || !match.pk_y) return null;

  return {
    keyIndex: match.index,
    pkX: ensure0x(match.pk_x),
    pkY: ensure0x(match.pk_y),
    scanPk: await resolveRecipientScanPk(address),
  };
}

async function resolveRecipientScanPk(address: string): Promise<string | undefined> {
  try {
    const output = await runWalletCommand(["--json", "scan-keys"], WALLET_DB);
    const result = JSON.parse(output) as {
      scan_keys?: Array<{ pk_x?: string; scan_pk_hex?: string }>;
    };
    const match = (result.scan_keys || []).find((key) => normalizeHex(key.pk_x || "") === address);
    return match?.scan_pk_hex ? ensure0x(match.scan_pk_hex) : undefined;
  } catch {
    return undefined;
  }
}

function runWalletCommand(extraArgs: string[], dbPath?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const db = dbPath || WALLET_DB;
    const args = [WALLET_SCRIPT, "--node-url", NODE_URL];
    if (db) args.push("--db", db);
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

async function syncFaucetWallet(): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [WALLET_SCRIPT, "--node-url", NODE_URL];
    if (FAUCET_DB) args.push("--db", FAUCET_DB);
    args.push("scan");

    const safeEnv: NodeJS.ProcessEnv = {
      PATH: `${process.env.NARGO_PATH || ""}:${process.env.PATH || "/usr/bin:/usr/local/bin"}`.replace(/^:/, ""),
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
    };
    if (process.env.PYTHONPATH) safeEnv.PYTHONPATH = process.env.PYTHONPATH;
    if (process.env.TONKL_RPC_SECRET) safeEnv.TONKL_RPC_SECRET = process.env.TONKL_RPC_SECRET;

    const child = spawn(PYTHON, args, {
      stdio: ["ignore", "pipe", "pipe"] as const,
      env: safeEnv,
    });

    const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Scan timed out")); }, 10_000);
    child.on("close", () => { clearTimeout(timeout); resolve(); }); // non-fatal
    child.on("error", () => { clearTimeout(timeout); resolve(); }); // non-fatal
  });
}

function runFaucet(pkX: string, pkY: string, amount: string, scanPk?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    activeDispenses++;

    const args = [WALLET_SCRIPT, "--node-url", NODE_URL];
    // Use the FAUCET wallet (funded at genesis), not the user's wallet
    if (FAUCET_DB) args.push("--db", FAUCET_DB);
    args.push("faucet", "--to-pk-x", pkX, "--to-pk-y", pkY, "--amount", amount);
    if (scanPk) args.push("--to-scan-pk", scanPk);

    // SECURITY: Recipient spending key stays inside the wallet process.
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: `${process.env.NARGO_PATH || ""}:${process.env.PATH || "/usr/bin:/usr/local/bin"}`.replace(/^:/, ""),
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
    };
    if (process.env.PYTHONPATH) safeEnv.PYTHONPATH = process.env.PYTHONPATH;
    if (process.env.TONKL_RPC_SECRET) safeEnv.TONKL_RPC_SECRET = process.env.TONKL_RPC_SECRET;

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
