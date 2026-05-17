/**
 * Prepare Spendable Notes API
 *
 * Fresh faucet wallets may hold one positive note and no zero-value padding
 * note. The transfer circuit needs two inputs, so this route performs an
 * explicit user-triggered split that keeps the user's balance the same while
 * creating zero-value padding notes for later sends.
 */

import { spawn } from "node:child_process";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

const NODE_URL = process.env.TONKL_NODE_URL || "http://127.0.0.1:9100";
const WALLET_SCRIPT = process.env.TONKL_WALLET_SCRIPT || "";
const WALLET_DB = process.env.TONKL_WALLET_DB || "";
const PYTHON = process.env.TONKL_PYTHON || "python3";

const RATE_LIMIT = { max: 2, windowMs: 60_000 };
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_BODY_SIZE = 1024;
const MAX_CONCURRENT = 1;

let activePrep = 0;

type PrepareRequest = {
  assetId?: string;
  passphrase?: string;
};

type WalletNote = {
  id?: number;
  value?: number;
  asset_id?: string;
  state?: string;
  tree_index?: number | null;
};

export async function POST(request: Request) {
  const authFailed = requireSession(request);
  if (authFailed) return authFailed;

  const clientKey = getClientKey(request);
  const limited = checkRateLimit("prepare-spendable", clientKey, RATE_LIMIT);
  if (limited) return limited;

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

  let body: PrepareRequest = {};
  try {
    body = (await request.json()) as PrepareRequest;
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Could not parse request." },
      { status: 400 }
    );
  }

  const assetId = body.assetId || "1";
  if (!/^\d{1,4}$/.test(assetId)) {
    return Response.json(
      { error: "invalid_asset", message: "Asset ID must be a number." },
      { status: 400 }
    );
  }

  if (activePrep >= MAX_CONCURRENT) {
    return Response.json(
      { error: "server_busy", message: "A wallet preparation proof is already running." },
      { status: 503 }
    );
  }

  try {
    const leafCount = await getNodeLeafCount();
    const notes = await getLiveNotes(assetId, leafCount, body.passphrase);
    const positiveNotes = notes.filter((note) => note.value > 0);
    const zeroNotes = notes.filter((note) => note.value === 0);

    if (positiveNotes.length === 0) {
      return Response.json(
        { error: "no_funds", message: "No spendable notes found for this asset." },
        { status: 400 }
      );
    }

    if (positiveNotes.length >= 2 || zeroNotes.length >= 1) {
      return Response.json({
        success: true,
        alreadyPrepared: true,
        message: "Wallet is already prepared for sending.",
        assetId,
        positiveNotes: positiveNotes.length,
        paddingNotes: zeroNotes.length,
      });
    }

    const note = positiveNotes[0];
    const output = await runSplit(note.id, note.value, assetId, body.passphrase);
    const txHash = extractTxHash(output);

    return Response.json({
      success: true,
      alreadyPrepared: false,
      message: "Wallet prepared for sending. Your balance is unchanged.",
      assetId,
      noteId: note.id,
      value: note.value,
      txHash,
      output: sanitizeOutput(output),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (process.env.NODE_ENV !== "production") {
      console.error("[prepare-spendable] Error:", sanitizeOutput(msg).slice(0, 500));
    }

    const lowered = msg.toLowerCase();
    if (lowered.includes("node unavailable") || lowered.includes("fetch failed")) {
      return Response.json(
        { error: "node_unavailable", message: "Could not reach the Tonkl node." },
        { status: 502 }
      );
    }

    if (
      lowered.includes("tree_index") ||
      lowered.includes("merkle") ||
      lowered.includes("witness") ||
      lowered.includes("node only has")
    ) {
      return Response.json(
        {
          error: "wallet_state_mismatch",
          message: "Wallet notes are out of sync with the node. Run scan/sync, then try again.",
        },
        { status: 409 }
      );
    }

    return Response.json(
      { error: "prepare_failed", message: "Could not prepare the wallet for sending." },
      { status: 500 }
    );
  }
}

async function getNodeLeafCount(): Promise<number> {
  const resp = await fetch(NODE_URL, {
    method: "POST",
    headers: rpcHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "get_status",
      params: [],
      id: 1,
    }),
  });
  const body = await resp.json();
  const leafCount = body?.result?.leaf_count;
  if (!resp.ok || body?.error || typeof leafCount !== "number") {
    throw new Error("Node unavailable");
  }
  return leafCount;
}

function rpcHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.TONKL_RPC_SECRET) {
    headers.Authorization = `Bearer ${process.env.TONKL_RPC_SECRET}`;
  }
  return headers;
}

async function getLiveNotes(
  assetId: string,
  leafCount: number,
  passphrase?: string
): Promise<Array<{ id: number; value: number; treeIndex: number }>> {
  const output = await runWallet(["--json", "notes", "--asset", assetId], 20_000, passphrase);
  const parsed = JSON.parse(output) as { notes?: WalletNote[] };
  const seenTreeIndexes = new Set<number>();

  return (parsed.notes || [])
    .filter((note) => note.state === "unspent")
    .map((note) => ({
      id: typeof note.id === "number" ? note.id : 0,
      value: typeof note.value === "number" ? note.value : -1,
      treeIndex: typeof note.tree_index === "number" ? note.tree_index : -1,
    }))
    .filter((note) => {
      if (note.id <= 0 || note.value < 0 || note.treeIndex < 0) return false;
      if (note.treeIndex >= leafCount) return false;
      if (seenTreeIndexes.has(note.treeIndex)) return false;
      seenTreeIndexes.add(note.treeIndex);
      return true;
    })
    .sort((a, b) => b.value - a.value);
}

function runSplit(
  noteId: number,
  value: number,
  assetId: string,
  passphrase?: string
): Promise<string> {
  return runWallet(
    ["split", String(noteId), "--values", String(value), "--asset-id", assetId],
    REQUEST_TIMEOUT_MS,
    passphrase,
    true
  );
}

function runWallet(
  commandArgs: string[],
  timeoutMs: number,
  passphrase?: string,
  countsAsPrep = false
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (countsAsPrep) activePrep++;

    const args = [WALLET_SCRIPT, "--node-url", NODE_URL];
    if (WALLET_DB) args.push("--db", WALLET_DB);
    if (passphrase) args.push("--passphrase-stdin");
    args.push(...commandArgs);

    const safeEnv: NodeJS.ProcessEnv = {
      PATH: `${process.env.NARGO_PATH || ""}:${process.env.PATH || "/usr/bin:/usr/local/bin"}`.replace(/^:/, ""),
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "en_US.UTF-8",
      NODE_ENV: process.env.NODE_ENV,
    };
    if (process.env.PYTHONPATH) safeEnv.PYTHONPATH = process.env.PYTHONPATH;
    if (process.env.VIRTUAL_ENV) safeEnv.VIRTUAL_ENV = process.env.VIRTUAL_ENV;
    if (process.env.TONKL_RPC_SECRET) safeEnv.TONKL_RPC_SECRET = process.env.TONKL_RPC_SECRET;

    const child = spawn(PYTHON, args, {
      stdio: [passphrase ? "pipe" : "ignore", "pipe", "pipe"] as const,
      env: safeEnv,
    });

    if (!child.stdout || !child.stderr) {
      if (countsAsPrep) activePrep--;
      reject(new Error("Wallet pipe setup failed"));
      return;
    }

    if (passphrase && child.stdin) {
      child.stdin.write(`${passphrase}\n`);
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      if (countsAsPrep) activePrep--;
      reject(new Error("Wallet command timed out"));
    }, timeoutMs);

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
      if (countsAsPrep) activePrep--;
      reject(error);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      if (countsAsPrep) activePrep--;
      if (code !== 0) {
        reject(new Error(`${stdout}\n${stderr}`.slice(0, 1500)));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function extractTxHash(output: string): string | null {
  const match = output.match(/(?:TX|tx)[_ ]?hash[:\s]+([0-9a-fA-Fx]+)/i);
  return match ? match[1] : null;
}

function sanitizeOutput(output: string): string {
  return output
    .replace(/\/[^\s]+\.(py|db|toml|json|gz)/g, "[path]")
    .replace(/0x[0-9a-fA-F]{64,}/g, (m) => `${m.slice(0, 10)}...`)
    .replace(/"spending_sk"\s*:\s*"[^"]*"/gi, '"spending_sk":"[redacted]"')
    .replace(/"scan_sk"\s*:\s*"[^"]*"/gi, '"scan_sk":"[redacted]"')
    .replace(/"mnemonic"\s*:\s*"[^"]*"/gi, '"mnemonic":"[redacted]"')
    .slice(0, 2048);
}
