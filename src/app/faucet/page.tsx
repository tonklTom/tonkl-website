"use client";

import { useState, useCallback } from "react";

type FaucetStatus = "idle" | "loading" | "success" | "error";

type FaucetResponse = {
  success?: boolean;
  message?: string;
  amount?: string;
  error?: string;
  retryAfterSeconds?: number;
};

export default function FaucetPage() {
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<FaucetStatus>("idle");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const trimmed = address.trim();
      if (!trimmed) return;

      // Basic client-side validation
      if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        setStatus("error");
        setMessage("Address must be a 64-character hex public key.");
        return;
      }

      setStatus("loading");
      setMessage("");

      try {
        const resp = await fetch("/api/faucet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: trimmed }),
        });

        const data: FaucetResponse = await resp.json();

        if (resp.ok && data.success) {
          setStatus("success");
          setMessage(data.message || "Tokens sent!");
          setAmount(data.amount || "100");
          setAddress("");
        } else if (resp.status === 429) {
          setStatus("error");
          const retry = data.retryAfterSeconds
            ? ` Try again in ${Math.ceil(data.retryAfterSeconds / 60)} minutes.`
            : "";
          setMessage(`Rate limited.${retry}`);
        } else {
          setStatus("error");
          setMessage(data.message || "Something went wrong.");
        }
      } catch {
        setStatus("error");
        setMessage("Could not reach the faucet. Please try again.");
      }
    },
    [address]
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black text-white px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Testnet Faucet</h1>
          <p className="text-sm text-neutral-400">
            Get free testnet TNKL tokens to try the Tonkl protocol.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="address"
              className="block text-xs font-medium text-neutral-400 uppercase tracking-wider"
            >
              Wallet Address
            </label>
            <input
              id="address"
              type="text"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                if (status !== "idle" && status !== "loading") setStatus("idle");
              }}
              placeholder="Paste your 64-character hex public key"
              maxLength={64}
              spellCheck={false}
              autoComplete="off"
              disabled={status === "loading"}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm
                         font-mono placeholder:text-neutral-600 focus:border-cyan-500/50 focus:outline-none
                         focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={status === "loading" || !address.trim()}
            className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black
                       transition-all hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed
                       active:scale-[0.98]"
          >
            {status === "loading" ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner />
                Sending tokens...
              </span>
            ) : (
              "Request Testnet TNKL"
            )}
          </button>
        </form>

        {/* Status message */}
        {status === "success" && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <p className="font-medium">Tokens sent!</p>
            <p className="mt-1 text-emerald-400/70">
              {amount} TNKL have been sent to your address. They should appear in
              your wallet within a few seconds.
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {message}
          </div>
        )}

        {/* Info */}
        <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/30 px-4 py-4">
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
            How it works
          </h2>
          <div className="space-y-2 text-sm text-neutral-500">
            <p>
              This faucet dispenses <span className="text-neutral-300">100 TNKL</span> per
              request from the testnet treasury.
            </p>
            <p>
              Limited to <span className="text-neutral-300">1 request per address per hour</span> and{" "}
              <span className="text-neutral-300">10 requests per IP per hour</span>.
            </p>
            <p>
              Testnet tokens have no real value. They exist for testing the
              Tonkl privacy protocol.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
