/**
 * Tonkl Node RPC Proxy (Hardened)
 *
 * Proxies JSON-RPC calls from the Tonkl frontend to the Tonkl node.
 * Keeps the node URL server-side only — never exposed to the browser.
 *
 * Security measures:
 *  - Strict read-only method whitelist (no write ops like produce_block)
 *  - Rate limiting per client IP (60 req/min)
 *  - Request body size cap (8 KB)
 *  - No internal URLs or stack traces in error responses
 *  - Params validated to prevent oversized or deeply nested payloads
 *
 * Usage:  POST /api/node  { method: "get_status", params: [] }
 */

import { checkRateLimit, getClientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

const NODE_URL = process.env.TONKL_NODE_URL || "http://127.0.0.1:9100";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BODY_SIZE = 8 * 1024; // 8 KB

// ─── Rate limit: 60 requests per minute per IP ─────────────────
const RATE_LIMIT = { max: 60, windowMs: 60_000 };

// ─── Read-only method whitelist ────────────���────────────────────
// SECURITY: Only read methods. Write methods (produce_block, submit_tx)
// must NEVER be proxied from the public frontend.
const ALLOWED_METHODS = new Set([
  "get_status",
  "get_block",
  "get_tx_status",
  "get_nullifier_status",
  "get_nullifiers",
  "get_merkle_proof",
  "get_encrypted_notes",
]);

// Maximum depth/size for params to prevent payload abuse
const MAX_PARAMS_LENGTH = 10;
const MAX_PARAM_STRING_LENGTH = 256;

type RpcRequest = {
  method?: string;
  params?: unknown[];
};

export async function POST(request: Request) {
  // ── Rate limit ──────────────────────────────────────────────
  const clientKey = getClientKey(request);
  const limited = checkRateLimit("node", clientKey, RATE_LIMIT);
  if (limited) return limited;

  // ── Body size check ──────────────────────���──────────────────
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return Response.json(
      { error: "payload_too_large", message: "Request body exceeds 8 KB limit." },
      { status: 413 }
    );
  }

  // ── Parse JSON ──────────────────────────────────���───────────
  let body: RpcRequest;
  try {
    body = (await request.json()) as RpcRequest;
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Could not parse request as JSON." },
      { status: 400 }
    );
  }

  // ── Validate method ─────────────────────────────────────────
  const method = typeof body.method === "string" ? body.method.trim() : "";

  if (!method) {
    return Response.json(
      { error: "missing_method", message: "Provide a JSON-RPC method name." },
      { status: 400 }
    );
  }

  if (!ALLOWED_METHODS.has(method)) {
    return Response.json(
      { error: "method_not_allowed", message: "Method is not available." },
      { status: 403 }
    );
  }

  // ── Validate params ─────────────────────────────────────────
  const params = Array.isArray(body.params) ? body.params : [];

  if (params.length > MAX_PARAMS_LENGTH) {
    return Response.json(
      { error: "invalid_params", message: "Too many parameters." },
      { status: 400 }
    );
  }

  // Reject deeply nested objects or oversized strings in params
  for (const p of params) {
    if (!isValidParam(p)) {
      return Response.json(
        { error: "invalid_params", message: "Parameter value is invalid or too large." },
        { status: 400 }
      );
    }
  }

  // ── Forward to node ─────────────────────────────────────────
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const resp = await fetch(NODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: Date.now(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const rpcBody = await resp.json();

    if (rpcBody.error) {
      // Sanitize: only forward the error code/message, not internal details
      return Response.json(
        {
          error: "rpc_error",
          message: typeof rpcBody.error.message === "string"
            ? rpcBody.error.message
            : "RPC returned an error",
        },
        { status: 502 }
      );
    }

    return Response.json({ result: rpcBody.result });
  } catch (err) {
    // SECURITY: Never leak NODE_URL or internal error details
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return Response.json(
      {
        error: "node_unreachable",
        message: isTimeout
          ? "Node request timed out"
          : "Cannot reach the Tonkl node",
        connected: false,
      },
      { status: 502 }
    );
  }
}

/**
 * GET /api/node — quick health check
 * SECURITY: Never expose NODE_URL in the response.
 */
export async function GET() {
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

    if (body.error) {
      return Response.json({ connected: false, error: "Node returned an error" });
    }

    return Response.json({
      connected: true,
      status: body.result,
    });
  } catch {
    return Response.json({
      connected: false,
      message: "Node is offline or unreachable",
    });
  }
}

// ─── Helpers ────────���─────────────────────────────────────────────

/**
 * Validate that a param is a safe primitive (string, number, boolean, null)
 * or a shallow array/object of primitives. Rejects deeply nested structures.
 */
function isValidParam(value: unknown, depth = 0): boolean {
  if (depth > 2) return false; // max nesting depth

  if (value === null || value === undefined) return true;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (typeof value === "string") return value.length <= MAX_PARAM_STRING_LENGTH;

  if (Array.isArray(value)) {
    if (value.length > MAX_PARAMS_LENGTH) return false;
    return value.every((v) => isValidParam(v, depth + 1));
  }

  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length > MAX_PARAMS_LENGTH) return false;
    return keys.every((k) =>
      k.length <= 64 &&
      isValidParam((value as Record<string, unknown>)[k], depth + 1)
    );
  }

  return false;
}
