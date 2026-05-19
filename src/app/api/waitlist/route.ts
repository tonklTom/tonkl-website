import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Rate limit: simple in-memory per-IP, 5 signups per hour
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW
  );
  rateLimitMap.set(ip, timestamps);
  if (timestamps.length >= RATE_LIMIT_MAX) return true;
  timestamps.push(now);
  return false;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return Response.json(
      { error: "rate_limited", message: "Too many signups. Try again later." },
      { status: 429 }
    );
  }

  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Could not parse request." },
      { status: 400 }
    );
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json(
      { error: "invalid_email", message: "Please provide a valid email address." },
      { status: 400 }
    );
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json(
      { error: "not_configured", message: "Waitlist is not configured yet." },
      { status: 503 }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Check for duplicate
  const { data: existing } = await supabase
    .from("waitlist")
    .select("id")
    .eq("email", email)
    .limit(1);

  if (existing && existing.length > 0) {
    return Response.json({ success: true, message: "You're already on the list." });
  }

  const { error } = await supabase.from("waitlist").insert({ email });

  if (error) {
    return Response.json(
      { error: "insert_failed", message: "Could not join waitlist. Try again." },
      { status: 500 }
    );
  }

  // Get total count for display
  const { count } = await supabase
    .from("waitlist")
    .select("*", { count: "exact", head: true });

  return Response.json({ success: true, count: count || 0 });
}

export async function GET() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ count: 0 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { count } = await supabase
    .from("waitlist")
    .select("*", { count: "exact", head: true });

  return Response.json({ count: count || 0 });
}
