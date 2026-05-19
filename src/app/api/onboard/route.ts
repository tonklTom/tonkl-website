/**
 * Wallet Onboarding API
 *
 * Handles wallet creation, seed generation, key derivation, unlock,
 * and restore. These are write operations separated from the read-only
 * /api/wallet endpoint for security clarity.
 *
 * Actions:
 *   POST /api/onboard { action: "create" }
 *     → Creates wallet DB, generates seed, derives first key
 *     → Returns { mnemonic, address }
 *
 *   POST /api/onboard { action: "restore", mnemonic: "word1 word2 ..." }
 *     → Restores wallet from seed phrase, re-derives keys
 *     → Returns { address }
 *
 *   POST /api/onboard { action: "unlock", passphrase: "..." }
 *     → Tries to open encrypted wallet DB with given passphrase
 *     → Returns { unlocked: true, address } or 401
 *
 *   POST /api/onboard { action: "check" }
 *     → Checks if a wallet DB exists and whether it needs a passphrase
 *     → Returns { exists, needsPassphrase }
 *
 * Security:
 *  - Rate limited: 5 req/min per IP (creation is infrequent)
 *  - Passphrase never logged or echoed back
 *  - Seed phrase returned ONCE at creation — client must show it immediately
 *  - Only the wallet script path is used (never arbitrary commands)
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { createSession } from "@/lib/session";

export const runtime = "nodejs";

const NODE_URL =
  process.env.TONKL_NODE_URL || "http://127.0.0.1:9100";
const WALLET_SCRIPT =
  process.env.TONKL_WALLET_SCRIPT || "";
const WALLET_DB =
  process.env.TONKL_WALLET_DB || "";
const PYTHON = process.env.TONKL_PYTHON || "python3";

// Separate rate limits: create/restore are expensive (PBKDF2 + disk I/O), unlock is cheap
const RATE_LIMIT_MUTATE = { max: 3, windowMs: 60_000 };  // create, restore
const RATE_LIMIT_UNLOCK = { max: 20, windowMs: 60_000 }; // unlock
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_SIZE = 4 * 1024; // 4 KB
const MAX_CONCURRENT = 1; // Only one onboarding at a time
let activeOps = 0;

type OnboardRequest = {
  action?: string;
  passphrase?: string;
  mnemonic?: string;
};

const VALID_ACTIONS = new Set(["create", "restore", "unlock", "check"]);

// Mnemonic validation: 24 BIP-39 words (lowercase alpha, space-separated)
const MNEMONIC_PATTERN = /^[a-z]+( [a-z]+){23}$/;

export async function POST(request: Request) {
  // ── Body size check ─────────────────────────────────────────
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return Response.json(
      { error: "payload_too_large", message: "Request body exceeds limit." },
      { status: 413 }
    );
  }

  // ── Parse body ──────────────────────────────────────────────
  let body: OnboardRequest;
  try {
    body = (await request.json()) as OnboardRequest;
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Could not parse request." },
      { status: 400 }
    );
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!action || !VALID_ACTIONS.has(action)) {
    return Response.json(
      { error: "invalid_action", message: "Action must be one of: create, restore, unlock, check." },
      { status: 400 }
    );
  }

  // ── Rate limit (exempt "check" — it's just a filesystem stat) ──
  if (action !== "check") {
    const clientKey = getClientKey(request);
    // Stricter limits for create/restore (expensive), looser for unlock (cheap)
    const rateConfig = (action === "create" || action === "restore")
      ? RATE_LIMIT_MUTATE
      : RATE_LIMIT_UNLOCK;
    const limited = checkRateLimit(`onboard-${action}`, clientKey, rateConfig);
    if (limited) return limited;
  }

  // ── Wallet script must be configured ────────────────────────
  if (!WALLET_SCRIPT) {
    return Response.json(
      { error: "not_configured", message: "Wallet backend is not configured." },
      { status: 503 }
    );
  }

  // ── Concurrent limit ────────────────────────────────────────
  if (activeOps >= MAX_CONCURRENT) {
    return Response.json(
      { error: "server_busy", message: "Another wallet operation is in progress." },
      { status: 503 }
    );
  }

  // ── Dispatch by action ──────────────────────────────────────
  try {
    switch (action) {
      case "check":
        return handleCheck();

      case "create":
        return await handleCreate(body.passphrase);

      case "restore":
        return await handleRestore(body.mnemonic, body.passphrase);

      case "unlock":
        return await handleUnlock(body.passphrase);

      default:
        return Response.json(
          { error: "invalid_action", message: "Unknown action." },
          { status: 400 }
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Surface known wallet errors to the client
    if (msg.includes("already exists") || msg.includes("master seed")) {
      return Response.json(
        { error: "wallet_exists", message: "A wallet already exists. Use unlock instead." },
        { status: 409 }
      );
    }
    if (msg.includes("not a database") || msg.includes("encrypted")) {
      return Response.json(
        { error: "wrong_passphrase", message: "Wrong passphrase or wallet is encrypted." },
        { status: 401 }
      );
    }
    // Log server-side for debugging
    if (process.env.NODE_ENV !== "production") {
      console.error("[onboard] Error:", msg.slice(0, 300));
    }
    return Response.json(
      { error: "onboard_error", message: "Wallet operation failed. Check that the node is running." },
      { status: 500 }
    );
  }
}

// ─── Action Handlers ───────────────────────────────────────────

function handleCheck(): Response {
  // Check if a wallet DB file exists
  const dbPath = WALLET_DB || getDefaultDbPath();
  const exists = existsSync(dbPath);

  return Response.json({
    exists,
    dbConfigured: !!WALLET_DB,
    // We can't easily check if it's encrypted without trying to open it
    // The frontend should try "unlock" with empty passphrase first
  });
}

async function handleCreate(passphrase?: string): Promise<Response> {
  // Run: init-seed --json (generates seed + derives first key)
  // The CLI outputs the mnemonic to stdout
  const args: string[] = [];
  // SECURITY: Pass passphrase via stdin to avoid ps visibility
  if (passphrase) args.push("--passphrase-stdin");
  args.push("--json", "init-seed");

  const output = await runWalletArgs(args, passphrase);

  // Parse the JSON output from --json mode
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    // If not JSON, try to parse the text output for the mnemonic
    result = parseInitSeedOutput(output);
  }

  if (!result || !result.mnemonic) {
    return Response.json(
      { error: "create_failed", message: "Could not create wallet." },
      { status: 500 }
    );
  }

  // init-seed --json now returns pk_x directly; fall back to list-keys if missing
  let address = result.pk_x || "";

  if (!address) {
    try {
      const keyArgs: string[] = [];
      if (passphrase) keyArgs.push("--passphrase-stdin");
      keyArgs.push("--json", "list-keys");
      const keyOutput = await runWalletArgs(keyArgs, passphrase);
      const keyResult = JSON.parse(keyOutput);
      if (keyResult.keys && keyResult.keys.length > 0) {
        address = keyResult.keys[0].pk_x;
      }
    } catch {
      // Non-critical — we still have the mnemonic
    }
  }

  // Generate session token for authenticated API access
  const sessionToken = createSession(address || "new-wallet", passphrase);

  return Response.json({
    success: true,
    mnemonic: result.mnemonic,
    address,
    sessionToken,
  });
}

async function handleRestore(
  mnemonic?: string,
  passphrase?: string
): Promise<Response> {
  if (!mnemonic || typeof mnemonic !== "string") {
    return Response.json(
      { error: "missing_mnemonic", message: "Provide a 24-word seed phrase." },
      { status: 400 }
    );
  }

  const cleaned = mnemonic.trim().toLowerCase();
  if (!MNEMONIC_PATTERN.test(cleaned)) {
    return Response.json(
      { error: "invalid_mnemonic", message: "Seed phrase must be exactly 24 lowercase words." },
      { status: 400 }
    );
  }

  // Run: restore-seed word1 word2 ... --json
  const words = cleaned.split(" ");
  const args: string[] = [];
  if (passphrase) args.push("--passphrase-stdin");
  args.push("--json", "restore-seed", ...words);

  await runWalletArgs(args, passphrase);

  // Get derived address
  const keyArgs: string[] = [];
  if (passphrase) keyArgs.push("--passphrase-stdin");
  keyArgs.push("--json", "list-keys");

  let address = "";
  try {
    const keyOutput = await runWalletArgs(keyArgs, passphrase);
    const keyResult = JSON.parse(keyOutput);
    if (keyResult.keys && keyResult.keys.length > 0) {
      address = keyResult.keys[0].pk_x;
    }
  } catch {
    // Non-critical
  }

  const sessionToken = createSession(address || "restored-wallet", passphrase);

  return Response.json({
    success: true,
    address,
    sessionToken,
  });
}

async function handleUnlock(passphrase?: string): Promise<Response> {
  // Try to open the wallet with the given passphrase by running a read-only command
  // If the passphrase is wrong, SQLCipher will fail with "file is not a database"
  const args: string[] = [];
  if (passphrase) args.push("--passphrase-stdin");
  args.push("--json", "list-keys");

  try {
    const output = await runWalletArgs(args, passphrase);
    const result = JSON.parse(output);

    let address = "";
    if (result.keys && result.keys.length > 0) {
      address = result.keys[0].pk_x;
    }

    const sessionToken = createSession(address || "unlocked-wallet", passphrase);

    return Response.json({
      unlocked: true,
      address,
      keyCount: result.keys?.length || 0,
      sessionToken,
    });
  } catch {
    return Response.json(
      { error: "unlock_failed", message: "Wrong passphrase or wallet is corrupted." },
      { status: 401 }
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function getDefaultDbPath(): string {
  const home = process.env.HOME || "/tmp";
  return `${home}/.tonkl/node_wallet.db`;
}

function parseInitSeedOutput(output: string): { mnemonic?: string } | null {
  // Parse the text output from init-seed to extract the mnemonic
  // The CLI prints words in a table format: "  1. word1      2. word2      3. word3"
  const words: string[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    // Match patterns like "1. abstract" or " 1. abstract"
    const matches = line.matchAll(/\d+\.\s+(\w+)/g);
    for (const match of matches) {
      words.push(match[1].toLowerCase());
    }
  }

  if (words.length === 24) {
    return { mnemonic: words.join(" ") };
  }
  return null;
}

function runWalletArgs(extraArgs: string[], passphrase?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    activeOps++;

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
    if (process.env.VIRTUAL_ENV) safeEnv.VIRTUAL_ENV = process.env.VIRTUAL_ENV;

    const child = spawn(PYTHON, args, {
      stdio: [passphrase ? "pipe" : "ignore", "pipe", "pipe"] as const,
      env: safeEnv,
    });

    if (!child.stdout || !child.stderr) {
      activeOps--;
      reject(new Error("Wallet operation pipe setup failed"));
      return;
    }

    // SECURITY: Write passphrase via stdin instead of CLI arg
    if (passphrase && child.stdin) {
      child.stdin.write(passphrase + "\n");
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      activeOps--;
      reject(new Error("Wallet operation timed out"));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 16_384) stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk;
    });

    child.on("error", (error: Error) => {
      clearTimeout(timeout);
      activeOps--;
      reject(error);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      activeOps--;
      if (code !== 0) {
        // Combine stdout + stderr for error detection (wallet CLI prints
        // errors to stdout via _friendly_error, not always stderr)
        const combined = (stdout + "\n" + stderr).slice(0, 1000);
        if (process.env.NODE_ENV !== "production") {
          console.error(`[onboard] Failed (exit ${code}):`, combined.slice(0, 500));
        }
        reject(new Error(combined));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
