"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────

export type ChainStatus = {
  block_height: number;
  merkle_root: string;
  leaf_count: number;
  nullifier_count: number;
  mempool_size: number;
};

export type AssetBalance = {
  assetId: string;
  symbol: string;
  balance: string;
  balanceRaw: number;
};

export type WalletData = {
  balance: string;
  balanceRaw: number;
  noteCount: number;
  assets: AssetBalance[];
};

export type TonklState = {
  connected: boolean;
  loading: boolean;
  chain: ChainStatus | null;
  wallet: WalletData | null;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => Promise<void>;
};

// ─── Hook ────────────────────────────────────────────────────────

const POLL_INTERVAL = 5000; // 5 seconds

export function useTonkl(): TonklState {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Fetch node health + wallet summary in parallel
      const [nodeRes, walletRes] = await Promise.allSettled([
        fetch("/api/node").then((r) => r.json()),
        fetch("/api/wallet").then((r) => r.json()),
      ]);

      // Node status
      if (nodeRes.status === "fulfilled" && nodeRes.value.connected) {
        setConnected(true);
        setChain(nodeRes.value.status as ChainStatus);
        setError(null);
      } else {
        setConnected(false);
        setChain(null);
        setError("Node offline");
      }

      // Wallet data
      if (walletRes.status === "fulfilled" && walletRes.value.wallet) {
        setWallet(walletRes.value.wallet as WalletData);
      } else {
        // Wallet might not be configured — keep null but don't error
        setWallet(null);
      }

      setLastUpdated(Date.now());
    } catch (err) {
      setConnected(false);
      setError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = setTimeout(() => {
      void refresh();
    }, 0);
    intervalRef.current = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL);
    return () => {
      clearTimeout(initialRefresh);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  return { connected, loading, chain, wallet, error, lastUpdated, refresh };
}

// ─── Backwards compatibility export ──────────────────────────────

export { useTonkl as useObscura };
export type { TonklState as ObscuraState };

// ─── RPC Helper ──────────────────────────────────────────────────

export async function nodeRpc(
  method: string,
  params: unknown[] = []
): Promise<unknown> {
  const resp = await fetch("/api/node", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const body = await resp.json();
  if (body.error) throw new Error(body.message || "RPC error");
  return body.result;
}
