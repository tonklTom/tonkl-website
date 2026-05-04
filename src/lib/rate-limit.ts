/**
 * In-memory sliding-window rate limiter.
 *
 * Each key (typically client IP) gets a window of `windowMs` milliseconds.
 * If the number of requests in that window exceeds `max`, the request is
 * rejected with a 429 status.
 *
 * This is intentionally simple — no Redis, no external deps. Fine for a
 * single-process Next.js server on a testnet VPS. Swap for something
 * distributed if you ever need horizontal scaling.
 */

type WindowEntry = {
  timestamps: number[];
};

export type RateLimitConfig = {
  /** Maximum requests per window */
  max: number;
  /** Window duration in milliseconds */
  windowMs: number;
};

const stores = new Map<string, Map<string, WindowEntry>>();

// Periodic cleanup to prevent memory leaks from abandoned IPs
const CLEANUP_INTERVAL = 60_000; // 1 minute
const cleanupTimers = new Map<string, ReturnType<typeof setInterval>>();

function getStore(namespace: string): Map<string, WindowEntry> {
  let store = stores.get(namespace);
  if (!store) {
    store = new Map();
    stores.set(namespace, store);

    // Start cleanup timer for this namespace
    const timer = setInterval(() => {
      const now = Date.now();
      const s = stores.get(namespace);
      if (!s) return;
      for (const [key, entry] of s) {
        // Remove entries with no recent activity
        entry.timestamps = entry.timestamps.filter((t) => now - t < 300_000);
        if (entry.timestamps.length === 0) s.delete(key);
      }
    }, CLEANUP_INTERVAL);
    // Allow process to exit without waiting for this timer
    if (timer.unref) timer.unref();
    cleanupTimers.set(namespace, timer);
  }
  return store;
}

/**
 * Check whether a request should be rate-limited.
 *
 * @returns `null` if allowed, or a Response (429) if limited.
 */
export function checkRateLimit(
  namespace: string,
  key: string,
  config: RateLimitConfig
): Response | null {
  const store = getStore(namespace);
  const now = Date.now();

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Slide the window: drop timestamps outside the window
  entry.timestamps = entry.timestamps.filter(
    (t) => now - t < config.windowMs
  );

  if (entry.timestamps.length >= config.max) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = config.windowMs - (now - oldestInWindow);
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);

    return new Response(
      JSON.stringify({
        error: "rate_limited",
        message: "Too many requests. Please try again later.",
        retryAfterSeconds: retryAfterSec,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfterSec),
        },
      }
    );
  }

  entry.timestamps.push(now);
  return null;
}

/**
 * Extract a usable client identifier from the request.
 * Prefers X-Forwarded-For (behind nginx), falls back to a constant.
 */
export function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Take the first IP (client IP before any proxies)
    return forwarded.split(",")[0].trim();
  }
  // Fallback — in dev there's no forwarded header
  return request.headers.get("x-real-ip") || "unknown";
}
