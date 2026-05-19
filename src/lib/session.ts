/**
 * Lightweight in-memory session management for testnet API authentication.
 *
 * A session token is generated when a wallet is created or unlocked via
 * /api/onboard. Subsequent requests to protected routes (/api/send,
 * /api/token, /api/faucet) must include this token in the
 * X-Tonkl-Session header.
 *
 * Sessions expire after 24 hours of inactivity. Only one session per
 * client is allowed at a time.
 *
 * This is intentionally simple — no JWTs, no cookies, no persistence.
 * Fine for a single-process testnet. Swap for something real if you
 * need horizontal scaling or persistence across restarts.
 */

import { randomBytes } from "node:crypto";

type Session = {
  token: string;
  address: string;        // pk_x of the wallet that created this session
  passphrase?: string;    // DB encryption passphrase (in-memory only, never persisted)
  createdAt: number;
  lastUsed: number;
};

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSIONS = 100;                     // prevent memory exhaustion
const CLEANUP_INTERVAL = 5 * 60 * 1000;      // 5 minutes

// Token -> Session
// Use globalThis to survive Next.js HMR reloads in dev mode
const g = globalThis as unknown as { __tonklSessions?: Map<string, Session> };
if (!g.__tonklSessions) {
  g.__tonklSessions = new Map<string, Session>();
}
const sessions = g.__tonklSessions;

// Periodic cleanup
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.lastUsed > SESSION_TTL_MS) {
      sessions.delete(token);
    }
  }
}, CLEANUP_INTERVAL);
if (cleanupTimer.unref) cleanupTimer.unref();

/**
 * Create a new session for the given wallet address.
 * Returns the session token (32 hex chars).
 */
export function createSession(address: string, passphrase?: string): string {
  // Evict oldest session if at capacity
  if (sessions.size >= MAX_SESSIONS) {
    let oldestToken = "";
    let oldestTime = Infinity;
    for (const [token, session] of sessions) {
      if (session.lastUsed < oldestTime) {
        oldestTime = session.lastUsed;
        oldestToken = token;
      }
    }
    if (oldestToken) sessions.delete(oldestToken);
  }

  const token = randomBytes(16).toString("hex");
  const now = Date.now();
  sessions.set(token, {
    token,
    address,
    passphrase,
    createdAt: now,
    lastUsed: now,
  });
  return token;
}

/**
 * Validate a session token from a request.
 *
 * @returns The session if valid, or null if invalid/expired.
 *          Updates lastUsed on success.
 */
export function validateSession(request: Request): Session | null {
  const token = request.headers.get("x-tonkl-session");
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  // Check expiry
  if (Date.now() - session.lastUsed > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }

  // Touch
  session.lastUsed = Date.now();
  return session;
}

/**
 * Check if a request has a valid session. Returns a 401 Response if not,
 * or null if the session is valid.
 *
 * Usage:
 *   const authFailed = requireSession(request);
 *   if (authFailed) return authFailed;
 */
/**
 * Get the passphrase associated with a valid session.
 * Returns undefined if no session or no passphrase stored.
 */
export function getSessionPassphrase(request: Request): string | undefined {
  const session = validateSession(request);
  return session?.passphrase;
}

export function requireSession(request: Request): Response | null {
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
  return null;
}
