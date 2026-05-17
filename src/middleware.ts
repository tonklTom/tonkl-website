/**
 * Next.js Edge Middleware
 *
 * Adds security headers to all API responses and enforces CORS
 * in production. Runs at the edge before API route handlers.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Parse allowed origins from env. Production defaults to same-origin only.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, X-Tonkl-Session";
const CORS_MAX_AGE = "86400";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handlePreflight(request);
  }

  const response = NextResponse.next();

  // ── Security headers ────────────────────────────────────────
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // ── CORS headers ────────────────────────────────────────────
  const origin = request.headers.get("origin");
  const allowedOrigin = getAllowedCorsOrigin(request, origin);
  if (allowedOrigin) {
    setCorsHeaders(response.headers, allowedOrigin);
  }

  return response;
}

function handlePreflight(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  const allowedOrigin = getAllowedCorsOrigin(request, origin);

  if (allowedOrigin) {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(allowedOrigin),
    });
  }

  return new NextResponse(null, { status: 403 });
}

function getAllowedCorsOrigin(request: NextRequest, origin: string | null): string | null {
  if (!origin) return null;

  // In development, allow all origins
  if (process.env.NODE_ENV !== "production") return origin;

  // Same-origin browser requests stay allowed even with no explicit whitelist.
  if (origin === request.nextUrl.origin) return origin;

  // Production cross-origin access must be explicit.
  if (ALLOWED_ORIGINS.includes(origin)) return origin;

  return null;
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": CORS_MAX_AGE,
    Vary: "Origin",
  };
}

function setCorsHeaders(headers: Headers, origin: string): void {
  const values = corsHeaders(origin);
  for (const [key, value] of Object.entries(values)) {
    headers.set(key, value);
  }
}

export const config = {
  matcher: "/api/:path*",
};
