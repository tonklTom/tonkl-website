"use client";

const SESSION_TOKEN_KEY = "tonkl.sessionToken";

export function getTonklSessionToken(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
}

export function storeTonklSessionToken(token: unknown): void {
  if (typeof window === "undefined") return;
  if (typeof token === "string" && token.trim()) {
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, token.trim());
  }
}

export function clearTonklSessionToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

export function tonklSessionHeaders(): Record<string, string> {
  const token = getTonklSessionToken();
  return token ? { "X-Tonkl-Session": token } : {};
}
