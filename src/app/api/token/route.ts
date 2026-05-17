/**
 * Token Creation & Registry API
 *
 * Handles token creation (register + optional mint), listing,
 * and metadata storage for custom tokens on the Tonkl network.
 *
 * POST /api/token { action: "create", ... }  → Create a new token
 * POST /api/token { action: "mint", ... }    → Mint more of an existing token
 * POST /api/token { action: "list" }         → List all custom tokens
 * POST /api/token { action: "get", assetId } → Get single token details
 * GET  /api/token                            → List all tokens (convenience)
 *
 * Security:
 *  - Rate limited: 10 per IP per minute
 *  - Concurrent limit: 1 (minting involves ZK proof generation)
 *  - Command whitelist: only create-token, mint-token, list-tokens
 *  - Passphrase never logged
 */

import { spawn } from "node:child_process";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

const NODE_URL =
  process.env.TONKL_NODE_URL || "http://127.0.0.1:9100";
const WALLET_SCRIPT =
  process.env.TONKL_WALLET_SCRIPT || "";
const WALLET_DB =
  process.env.TONKL_WALLET_DB || "";
const PYTHON = process.env.TONKL_PYTHON || "python3";

const RATE_LIMIT = { max: 10, windowMs: 60_000 };
const MINT_TIMEOUT_MS = 120_000; // 2 minutes for proof generation
const CMD_TIMEOUT_MS = 15_000;
const MAX_BODY_SIZE = 8 * 1024; // 8 KB (metadata can be larger)
const MAX_CONCURRENT_MINTS = 1;

let activeMints = 0;

// Metadata storage directory (local for alpha; IPFS later)
const METADATA_DIR = process.env.TONKL_METADATA_DIR || join(process.cwd(), ".token-metadata");

// ─── Types ─────────────────────────────────────────────────────

type TokenCreateRequest = {
  action: "create";
  symbol: string;
  name: string;
  assetId?: string;
  decimals?: number;
  initialSupply?: number;
  numNotes?: number;
  passphrase?: string;
  // Metadata
  description?: string;
  category?: string;
  logoDataUrl?: string; // base64 data URL for logo
  website?: string;
  twitter?: string;
  discord?: string;
  telegram?: string;
  github?: string;
  creatorStatement?: string;
  // Advanced features
  burnRate?: number;     // 0-1000 basis points per transfer
  echoRate?: number;     // 0-1000 basis points to echo recipient
  echoRecipient?: string; // pk_x of echo destination
  supplyCap?: number;    // 0 = uncapped
  // Shlem assessment (added server-side)
};

type TokenMintRequest = {
  action: "mint";
  assetId: string;
  amount: number;
  numNotes?: number;
  passphrase?: string;
};

type TokenListRequest = {
  action: "list";
};

type TokenGetRequest = {
  action: "get";
  assetId: string;
};

type TokenRequest = TokenCreateRequest | TokenMintRequest | TokenListRequest | TokenGetRequest;

type TokenMetadata = {
  assetId: string;
  symbol: string;
  name: string;
  decimals: number;
  description: string;
  category: string;
  logoFile?: string;
  website: string;
  twitter: string;
  discord: string;
  telegram: string;
  github: string;
  creatorStatement: string;
  burnRate: number;
  echoRate: number;
  echoRecipient: string;
  supplyCap: number;
  initialSupply: number;
  createdAt: string;
  riskScore: string;
  riskDetails: string[];
  tier: "verified" | "standard" | "unverified";
  metadataComplete: boolean;
};

// ─── GET handler ───────────────────────────────────────────────

export async function GET(request: Request) {
  const clientKey = getClientKey(request);
  const limited = checkRateLimit("token", clientKey, RATE_LIMIT);
  if (limited) return limited;

  if (!WALLET_SCRIPT) {
    return Response.json(
      { error: "not_configured", message: "Wallet is not configured." },
      { status: 503 }
    );
  }

  try {
    const tokens = await listTokens();
    // Enrich with metadata
    const enriched = await Promise.all(
      tokens.map(async (t: Record<string, unknown>) => {
        const meta = await loadMetadata(String(t.asset_id || t.assetId || ""));
        return { ...t, metadata: meta };
      })
    );
    return Response.json({ tokens: enriched });
  } catch {
    return Response.json(
      { error: "list_failed", message: "Could not list tokens." },
      { status: 500 }
    );
  }
}

// ─── POST handler ──────────────────────────────────────────────

export async function POST(request: Request) {
  const clientKey = getClientKey(request);
  const limited = checkRateLimit("token", clientKey, RATE_LIMIT);
  if (limited) return limited;

  // Body size check
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return Response.json(
      { error: "payload_too_large", message: "Request too large." },
      { status: 413 }
    );
  }

  if (!WALLET_SCRIPT) {
    return Response.json(
      { error: "not_configured", message: "Wallet is not configured." },
      { status: 503 }
    );
  }

  let body: TokenRequest;
  try {
    body = (await request.json()) as TokenRequest;
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Could not parse request." },
      { status: 400 }
    );
  }

  const action = body.action;

  // ── Session auth for write operations ─────────────────────────
  if (action === "create" || action === "mint") {
    const authFailed = requireSession(request);
    if (authFailed) return authFailed;
  }

  switch (action) {
    case "create":
      return handleCreate(body as TokenCreateRequest);
    case "mint":
      return handleMint(body as TokenMintRequest);
    case "list":
      return handleList();
    case "get":
      return handleGet(body as TokenGetRequest);
    default:
      return Response.json(
        { error: "invalid_action", message: "Unknown action." },
        { status: 400 }
      );
  }
}

// ─── Handlers ──────────────────────────────────────────────────

async function handleCreate(body: TokenCreateRequest): Promise<Response> {
  // Validate required fields
  if (!body.symbol || typeof body.symbol !== "string" || body.symbol.trim().length === 0) {
    return Response.json(
      { error: "missing_symbol", message: "Token symbol is required." },
      { status: 400 }
    );
  }

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return Response.json(
      { error: "missing_name", message: "Token name is required." },
      { status: 400 }
    );
  }

  const symbol = body.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) {
    return Response.json(
      { error: "invalid_symbol", message: "Symbol must be 1-10 alphanumeric characters." },
      { status: 400 }
    );
  }

  const name = body.name.trim();
  if (name.length > 64) {
    return Response.json(
      { error: "name_too_long", message: "Name must be 64 characters or fewer." },
      { status: 400 }
    );
  }

  const decimals = body.decimals ?? 0;
  if (decimals < 0 || decimals > 18) {
    return Response.json(
      { error: "invalid_decimals", message: "Decimals must be 0-18." },
      { status: 400 }
    );
  }

  // Auto-assign asset ID if not provided
  let assetId = body.assetId;
  if (!assetId) {
    // Generate a random asset ID between 100 and 99999
    assetId = String(100 + Math.floor(Math.random() * 99900));
  }

  if (!/^\d{1,5}$/.test(assetId)) {
    return Response.json(
      { error: "invalid_asset_id", message: "Asset ID must be a 1-5 digit number." },
      { status: 400 }
    );
  }

  // ── Collision check: ensure this asset ID isn't already registered ──
  const existing = await loadMetadata(assetId);
  if (existing) {
    return Response.json(
      { error: "asset_id_collision", message: `Asset ID ${assetId} is already registered as ${existing.symbol}. Choose a different ID.` },
      { status: 409 }
    );
  }

  // Get authority key index from wallet. The private key stays inside the
  // wallet process and is never returned through list-keys or this API route.
  let authorityKeyIndex: number | null = null;
  try {
    const keysOutput = await runWalletCommand(["--json", "list-keys"]);
    const keysResult = JSON.parse(keysOutput) as { keys?: Array<{ index?: number }> };
    const firstKey = keysResult.keys?.[0];
    if (typeof firstKey?.index === "number") {
      authorityKeyIndex = firstKey.index;
    }
  } catch {
    return Response.json(
      { error: "no_keys", message: "Could not find wallet keys. Create a wallet first." },
      { status: 400 }
    );
  }

  if (authorityKeyIndex === null) {
    return Response.json(
      { error: "no_authority", message: "No spending key available to serve as token authority." },
      { status: 400 }
    );
  }

  // ── Register token via CLI ──────────────────────────────────
  const createArgs = [
    "create-token", symbol,
    "--name", name,
    "--asset-id", assetId,
    "--decimals", String(decimals),
    "--authority-key-index", String(authorityKeyIndex),
  ];

  const initialSupply = body.initialSupply || 0;
  if (initialSupply > 0) {
    if (activeMints >= MAX_CONCURRENT_MINTS) {
      return Response.json(
        { error: "server_busy", message: "A mint is already in progress. Try again shortly." },
        { status: 503 }
      );
    }
    createArgs.push("--initial-supply", String(initialSupply));
    if (body.numNotes && body.numNotes > 1) {
      createArgs.push("--num-notes", String(Math.min(body.numNotes, 32)));
    }
  }

  // SECURITY: Pass passphrase via stdin to avoid ps visibility
  if (body.passphrase) {
    createArgs.unshift("--passphrase-stdin");
  }

  try {
    const timeout = initialSupply > 0 ? MINT_TIMEOUT_MS : CMD_TIMEOUT_MS;
    if (initialSupply > 0) activeMints++;

    let output: string;
    try {
      output = await runWalletCommand(
        createArgs,
        timeout,
        body.passphrase,
        {},
        true
      );
    } finally {
      if (initialSupply > 0) activeMints--;
    }

    // ── Compute risk assessment ─────────────────────────────
    const riskDetails: string[] = [];
    let riskScore: "low" | "medium" | "high" | "critical" = "low";

    if (!body.description || body.description.trim().length < 20) {
      riskDetails.push("Missing or short description");
      riskScore = bumpRisk(riskScore, "medium");
    }
    if (!body.logoDataUrl) {
      riskDetails.push("No logo provided");
      riskScore = bumpRisk(riskScore, "medium");
    }
    if (!body.website) {
      riskDetails.push("No website URL");
    }
    if (!body.twitter && !body.discord && !body.telegram) {
      riskDetails.push("No social links provided");
      riskScore = bumpRisk(riskScore, "medium");
    }
    if (!body.creatorStatement || body.creatorStatement.trim().length < 10) {
      riskDetails.push("Missing creator statement");
    }
    if (initialSupply > 1_000_000_000) {
      riskDetails.push("Very large initial supply (>1B)");
      riskScore = bumpRisk(riskScore, "high");
    }

    // Determine tier
    let tier: "verified" | "standard" | "unverified" = "standard";
    const metadataComplete = !!(
      body.description && body.description.trim().length >= 20 &&
      body.logoDataUrl &&
      body.website &&
      (body.twitter || body.discord || body.telegram) &&
      body.creatorStatement && body.creatorStatement.trim().length >= 10
    );

    if (metadataComplete && riskScore === "low") {
      tier = "verified";
    } else if (riskScore === "high" || riskScore === "critical") {
      tier = "unverified";
    }

    // ── Save metadata ───────────────────────────────────────
    const metadata: TokenMetadata = {
      assetId,
      symbol,
      name,
      decimals,
      description: body.description?.trim() || "",
      category: body.category || "Other",
      website: body.website || "",
      twitter: body.twitter || "",
      discord: body.discord || "",
      telegram: body.telegram || "",
      github: body.github || "",
      creatorStatement: body.creatorStatement?.trim() || "",
      burnRate: body.burnRate || 0,
      echoRate: body.echoRate || 0,
      echoRecipient: body.echoRecipient || "",
      supplyCap: body.supplyCap || 0,
      initialSupply,
      createdAt: new Date().toISOString(),
      riskScore,
      riskDetails,
      tier,
      metadataComplete,
    };

    // Save logo if provided
    if (body.logoDataUrl) {
      try {
        const logoData = body.logoDataUrl.replace(/^data:image\/\w+;base64,/, "");
        const ext = body.logoDataUrl.match(/^data:image\/(\w+)/)?.[1] || "png";
        const logoFile = `${assetId}_logo.${ext}`;
        await mkdir(METADATA_DIR, { recursive: true });
        await writeFile(join(METADATA_DIR, logoFile), Buffer.from(logoData, "base64"));
        metadata.logoFile = logoFile;
      } catch {
        // Logo save failed — not critical
      }
    }

    await saveMetadata(assetId, metadata);

    return Response.json({
      success: true,
      token: {
        assetId,
        symbol,
        name,
        decimals,
        initialSupply,
        tier,
        riskScore,
        riskDetails,
        metadataComplete,
      },
      output: sanitizeOutput(output),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (process.env.NODE_ENV !== "production") {
      console.error("[token/create] Error:", msg.slice(0, 500));
    }

    if (msg.includes("already") && msg.includes("registered")) {
      return Response.json(
        { error: "already_exists", message: "A token with this asset ID or symbol already exists." },
        { status: 409 }
      );
    }

    // ── Partial success: token registered but mint failed ────
    // The CLI does register + mint in one command. If registration
    // succeeded but proof generation failed (e.g. nargo not found),
    // we still return success with a warning.
    if (msg.includes("Token registered") || msg.includes("registered!")) {
      // Parse asset ID from output if possible
      const idMatch = msg.match(/Asset ID:\s*(\d+)/);
      const parsedId = idMatch?.[1] || assetId;

      // Compute risk + save metadata even on partial success
      const riskDetails: string[] = ["Initial mint failed — supply not yet minted"];
      const riskScore: "low" | "medium" | "high" | "critical" = "medium";

      if (!body.description || body.description.trim().length < 20) {
        riskDetails.push("Missing or short description");
      }
      if (!body.logoDataUrl) {
        riskDetails.push("No logo provided");
      }

      const tier: "verified" | "standard" | "unverified" = "standard";
      const metadata: TokenMetadata = {
        assetId: parsedId,
        symbol,
        name,
        decimals,
        description: body.description?.trim() || "",
        category: body.category || "Other",
        website: body.website || "",
        twitter: body.twitter || "",
        discord: body.discord || "",
        telegram: body.telegram || "",
        github: body.github || "",
        creatorStatement: body.creatorStatement?.trim() || "",
        burnRate: body.burnRate || 0,
        echoRate: body.echoRate || 0,
        echoRecipient: body.echoRecipient || "",
        supplyCap: body.supplyCap || 0,
        initialSupply,
        createdAt: new Date().toISOString(),
        riskScore,
        riskDetails,
        tier,
        metadataComplete: false,
      };

      try { await saveMetadata(parsedId, metadata); } catch { /* best effort */ }

      return Response.json({
        success: true,
        warning: "Token registered but initial mint failed (proof generation unavailable). You can mint later.",
        token: {
          assetId: parsedId,
          symbol,
          name,
          decimals,
          initialSupply: 0,
          tier,
          riskScore,
          riskDetails,
          metadataComplete: false,
        },
        output: sanitizeOutput(msg),
      });
    }

    return Response.json(
      { error: "create_failed", message: "Token creation failed. Check the node is running." },
      { status: 500 }
    );
  }
}

async function handleMint(body: TokenMintRequest): Promise<Response> {
  if (!body.assetId || !/^\d{1,5}$/.test(body.assetId)) {
    return Response.json(
      { error: "invalid_asset_id", message: "Asset ID is required." },
      { status: 400 }
    );
  }

  if (!body.amount || body.amount <= 0 || !Number.isInteger(body.amount)) {
    return Response.json(
      { error: "invalid_amount", message: "Amount must be a positive integer." },
      { status: 400 }
    );
  }

  if (activeMints >= MAX_CONCURRENT_MINTS) {
    return Response.json(
      { error: "server_busy", message: "A mint is already in progress. Try again shortly." },
      { status: 503 }
    );
  }

  const args = [
    "mint-token",
    "--asset-id", body.assetId,
    "--amount", String(body.amount),
  ];
  if (body.numNotes && body.numNotes > 1) {
    args.push("--num-notes", String(Math.min(body.numNotes, 32)));
  }
  // SECURITY: Pass passphrase via stdin to avoid ps visibility
  if (body.passphrase) {
    args.unshift("--passphrase-stdin");
  }

  activeMints++;
  try {
    const output = await runWalletCommand(args, MINT_TIMEOUT_MS, body.passphrase, {}, true);
    return Response.json({
      success: true,
      message: `Minted ${body.amount} tokens for asset ${body.assetId}`,
      output: sanitizeOutput(output),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("authority")) {
      return Response.json(
        { error: "no_authority", message: "No authority key for this asset. You may not have permission to mint." },
        { status: 403 }
      );
    }
    return Response.json(
      { error: "mint_failed", message: "Minting failed. The node may be offline or proof generation failed." },
      { status: 500 }
    );
  } finally {
    activeMints--;
  }
}

async function handleList(): Promise<Response> {
  try {
    const tokens = await listTokens();
    const enriched = await Promise.all(
      tokens.map(async (t: Record<string, unknown>) => {
        const meta = await loadMetadata(String(t.asset_id || t.assetId || ""));
        return { ...t, metadata: meta };
      })
    );
    return Response.json({ tokens: enriched });
  } catch {
    return Response.json(
      { error: "list_failed", message: "Could not list tokens." },
      { status: 500 }
    );
  }
}

async function handleGet(body: TokenGetRequest): Promise<Response> {
  if (!body.assetId) {
    return Response.json(
      { error: "missing_asset_id", message: "Asset ID is required." },
      { status: 400 }
    );
  }
  // SECURITY: Validate format to prevent path traversal (e.g., "../../../etc/passwd")
  if (!/^\d{1,5}$/.test(body.assetId)) {
    return Response.json(
      { error: "invalid_asset_id", message: "Asset ID must be a 1-5 digit number." },
      { status: 400 }
    );
  }
  const meta = await loadMetadata(body.assetId);
  if (!meta) {
    return Response.json(
      { error: "not_found", message: "Token not found." },
      { status: 404 }
    );
  }
  return Response.json({ token: meta });
}

// ─── Helpers ───────────────────────────────────────────────────

async function listTokens(): Promise<Record<string, unknown>[]> {
  try {
    const output = await runWalletCommand(["--json", "list-tokens"]);
    const parsed = JSON.parse(output);
    return parsed.tokens || parsed.assets || [];
  } catch {
    // Fallback: check metadata dir
    return [];
  }
}

async function saveMetadata(assetId: string, metadata: TokenMetadata): Promise<void> {
  await mkdir(METADATA_DIR, { recursive: true });
  const path = join(METADATA_DIR, `${assetId}.json`);
  await writeFile(path, JSON.stringify(metadata, null, 2));
}

async function loadMetadata(assetId: string): Promise<TokenMetadata | null> {
  try {
    const path = join(METADATA_DIR, `${assetId}.json`);
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as TokenMetadata;
  } catch {
    return null;
  }
}

function runWalletCommand(
  extraArgs: string[],
  timeout = CMD_TIMEOUT_MS,
  passphrase?: string,
  secretEnv: Record<string, string> = {},
  includeRpcSecret = false
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [WALLET_SCRIPT, "--node-url", NODE_URL];
    if (WALLET_DB) args.push("--db", WALLET_DB);
    args.push(...extraArgs);

    // Include nargo path for ZK proof generation
    const nargoPath = process.env.NARGO_PATH || "";
    const basePath = process.env.PATH || "/usr/bin:/usr/local/bin";
    const fullPath = nargoPath ? `${nargoPath}:${basePath}` : basePath;

    const safeEnv: NodeJS.ProcessEnv = {
      PATH: fullPath,
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
    };
    if (process.env.PYTHONPATH) safeEnv.PYTHONPATH = process.env.PYTHONPATH;
    if (process.env.VIRTUAL_ENV) safeEnv.VIRTUAL_ENV = process.env.VIRTUAL_ENV;
    if (includeRpcSecret && process.env.TONKL_RPC_SECRET) {
      safeEnv.TONKL_RPC_SECRET = process.env.TONKL_RPC_SECRET;
    }
    for (const [key, value] of Object.entries(secretEnv)) {
      if (/^[A-Z0-9_]+$/.test(key) && value) {
        safeEnv[key] = value;
      }
    }

    const child = spawn(PYTHON, args, {
      stdio: [passphrase ? "pipe" : "ignore", "pipe", "pipe"] as const,
      env: safeEnv,
    });

    if (!child.stdout || !child.stderr) {
      reject(new Error("Wallet command pipe setup failed"));
      return;
    }

    // SECURITY: Write passphrase via stdin instead of CLI arg
    if (passphrase && child.stdin) {
      child.stdin.write(passphrase + "\n");
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Command timed out"));
    }, timeout);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 32_768) stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk;
    });

    child.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        const combined = (stdout + "\n" + stderr).slice(0, 1500);
        if (process.env.NODE_ENV !== "production") {
          console.error(`[token] Command failed (exit ${code}):`, combined.slice(0, 500));
        }
        reject(new Error(combined));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function sanitizeOutput(output: string): string {
  return output
    .replace(/\/[^\s]+\.(py|db|toml|json|gz)/g, "[path]")
    .replace(/0x[0-9a-fA-F]{64,}/g, (m) => m.slice(0, 10) + "...")
    .slice(0, 2048);
}

const RISK_ORDER = ["low", "medium", "high", "critical"] as const;
function bumpRisk(current: string, to: string): "low" | "medium" | "high" | "critical" {
  const ci = RISK_ORDER.indexOf(current as typeof RISK_ORDER[number]);
  const ti = RISK_ORDER.indexOf(to as typeof RISK_ORDER[number]);
  return RISK_ORDER[Math.max(ci, ti)];
}
