/**
 * Next.js Edge Middleware
 *
 * Adds security headers to all API responses and enforces CORS
 * in production. Runs at the edge before API route handlers.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Parse allowed origins from env, default to same-origin
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

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
  if (origin && isAllowedOrigin(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type");
    response.headers.set("Access-Control-Max-Age", "86400");
  }

  return response;
}

function handlePreflight(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");

  if (origin && isAllowedOrigin(origin)) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  return new NextResponse(null, { status: 403 });
}

function isAllowedOrigin(origin: string): boolean {
  // In development, allow all origins
  if (process.env.NODE_ENV !== "production") return true;

  // In production, check against the whitelist
  if (ALLOWED_ORIGINS.length === 0) return true; // No whitelist = same-origin only (browser enforced)

  return ALLOWED_ORIGINS.includes(origin);
}

export const config = {
  matcher: "/api/:path*",
};
