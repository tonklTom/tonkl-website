#!/usr/bin/env npx tsx
/**
 * Security Tests for Tonkl API Routes
 *
 * Tests rate limiting, input validation, injection prevention,
 * and information leakage across all API endpoints.
 *
 * Usage:
 *   1. Start the dev server:  npm run dev
 *   2. Run tests:  npx tsx tests/security-tests.ts
 *
 * Or with a custom base URL:
 *   BASE_URL=https://testnet.tonkl.com npx tsx tests/security-tests.ts
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

let passed = 0;
let failed = 0;
let skipped = 0;

// ─── Helpers ────────────────────────────────────────────────────

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getJson(path: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`);
}

// ─── Node Route Tests ───────────────────────────────────────────

async function testNodeRoute() {
  console.log("\n── /api/node ──────────────────────────────────────");

  await test("GET health check returns connected status", async () => {
    const resp = await getJson("/api/node");
    const data = await resp.json();
    assert(resp.ok, `Expected 200, got ${resp.status}`);
    assert("connected" in data, "Response must have 'connected' field");
  });

  await test("GET health check does NOT leak node URL", async () => {
    const resp = await getJson("/api/node");
    const text = await resp.text();
    assert(!text.includes("127.0.0.1"), "Response must not contain internal IP");
    assert(!text.includes("9100"), "Response must not contain node port");
    assert(!text.includes("nodeUrl"), "Response must not contain nodeUrl field");
  });

  await test("POST with valid read method succeeds or returns node_unreachable", async () => {
    const resp = await postJson("/api/node", { method: "get_status", params: [] });
    const data = await resp.json();
    // Either the node is running (200) or not (502) — both are valid
    assert(
      resp.status === 200 || resp.status === 502,
      `Expected 200 or 502, got ${resp.status}`
    );
    assert("result" in data || "error" in data, "Must have result or error");
  });

  await test("POST with missing method returns 400", async () => {
    const resp = await postJson("/api/node", { params: [] });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("POST with empty method returns 400", async () => {
    const resp = await postJson("/api/node", { method: "", params: [] });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("BLOCKED: produce_block is not allowed", async () => {
    const resp = await postJson("/api/node", { method: "produce_block", params: [] });
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("BLOCKED: submit_tx is not allowed", async () => {
    const resp = await postJson("/api/node", { method: "submit_tx", params: [] });
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("BLOCKED: arbitrary method is not allowed", async () => {
    const resp = await postJson("/api/node", { method: "shutdown_node", params: [] });
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("Blocked method error does NOT echo method name", async () => {
    const resp = await postJson("/api/node", { method: "evil_method", params: [] });
    const text = await resp.text();
    assert(!text.includes("evil_method"), "Error must not echo the attempted method");
  });

  await test("Invalid JSON returns 400", async () => {
    const resp = await fetch(`${BASE_URL}/api/node`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("Too many params rejected", async () => {
    const params = Array.from({ length: 20 }, (_, i) => i);
    const resp = await postJson("/api/node", { method: "get_status", params });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("Oversized string param rejected", async () => {
    const resp = await postJson("/api/node", {
      method: "get_block",
      params: ["x".repeat(500)],
    });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("Deeply nested param rejected", async () => {
    const nested = { a: { b: { c: { d: "deep" } } } };
    const resp = await postJson("/api/node", {
      method: "get_block",
      params: [nested],
    });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("502 error does NOT leak internal URL", async () => {
    // Even when node is offline, the error should not contain the URL
    const resp = await postJson("/api/node", { method: "get_status", params: [] });
    if (resp.status === 502) {
      const text = await resp.text();
      assert(!text.includes("127.0.0.1"), "502 must not contain internal IP");
      assert(!text.includes("9100"), "502 must not contain node port");
    }
    // If node is online (200), this test is still a pass
  });
}

// ─── Wallet Route Tests ─────────────────────────────────────────

async function testWalletRoute() {
  console.log("\n── /api/wallet ────────────────────────────────────");

  await test("GET returns wallet data structure", async () => {
    const resp = await getJson("/api/wallet");
    const data = await resp.json();
    assert(resp.ok, `Expected 200, got ${resp.status}`);
    assert("connected" in data, "Must have connected field");
    assert("chain" in data, "Must have chain field");
    assert("wallet" in data, "Must have wallet field");
  });

  await test("GET does NOT leak file paths", async () => {
    const resp = await getJson("/api/wallet");
    const text = await resp.text();
    assert(!text.includes("/Users/"), "Must not contain /Users/ path");
    assert(!text.includes("/opt/"), "Must not contain /opt/ path");
    assert(!text.includes("obscura_wallet.py"), "Must not contain script name");
  });

  await test("POST with valid command returns data or error", async () => {
    const resp = await postJson("/api/wallet", { command: "balance" });
    // Wallet might not be configured (503) or command might fail (500) — both valid
    assert(
      [200, 500, 503].includes(resp.status),
      `Expected 200/500/503, got ${resp.status}`
    );
  });

  await test("POST with invalid command returns 403", async () => {
    const resp = await postJson("/api/wallet", { command: "send" });
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("BLOCKED: send command not allowed", async () => {
    const resp = await postJson("/api/wallet", { command: "send" });
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("BLOCKED: transfer command not allowed", async () => {
    const resp = await postJson("/api/wallet", { command: "transfer" });
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("BLOCKED: mint command not allowed", async () => {
    const resp = await postJson("/api/wallet", { command: "mint" });
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("BLOCKED: shell injection attempt", async () => {
    const resp = await postJson("/api/wallet", { command: "balance; rm -rf /" });
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("BLOCKED: pipe injection attempt", async () => {
    const resp = await postJson("/api/wallet", { command: "balance | cat /etc/passwd" });
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("Blocked command error does NOT echo command", async () => {
    const resp = await postJson("/api/wallet", { command: "evil_cmd_12345" });
    const text = await resp.text();
    assert(!text.includes("evil_cmd_12345"), "Error must not echo the attempted command");
  });

  await test("Invalid JSON returns 400", async () => {
    const resp = await fetch(`${BASE_URL}/api/wallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("Empty command returns 403", async () => {
    const resp = await postJson("/api/wallet", { command: "" });
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("Missing command field returns 403", async () => {
    const resp = await postJson("/api/wallet", {});
    assert(resp.status === 403, `Expected 403, got ${resp.status}`);
  });

  await test("500 error does NOT leak stderr/paths", async () => {
    // Even if a command fails, the error should be generic
    const resp = await postJson("/api/wallet", { command: "balance" });
    if (resp.status === 500) {
      const text = await resp.text();
      assert(!text.includes("/Users/"), "500 must not contain file paths");
      assert(!text.includes("Traceback"), "500 must not contain Python tracebacks");
      assert(!text.includes(".py"), "500 must not contain script filenames");
    }
  });
}

// ─── Faucet Route Tests ─────────────────────────────────────────

async function testFaucetRoute() {
  console.log("\n── /api/faucet ────────────────────────────────────");

  await test("GET returns faucet info", async () => {
    const resp = await getJson("/api/faucet");
    const data = await resp.json();
    assert(resp.ok, `Expected 200, got ${resp.status}`);
    assert(data.name === "Tonkl Testnet Faucet", "Must have correct name");
    assert("limits" in data, "Must have limits info");
  });

  await test("POST with missing address returns 400", async () => {
    const resp = await postJson("/api/faucet", {});
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("POST with empty address returns 400", async () => {
    const resp = await postJson("/api/faucet", { address: "" });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("POST with invalid address (too short) returns 400", async () => {
    const resp = await postJson("/api/faucet", { address: "abc123" });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("POST with invalid address (non-hex) returns 400", async () => {
    const resp = await postJson("/api/faucet", {
      address: "g".repeat(64), // 'g' is not hex
    });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("POST with injection in address returns 400", async () => {
    const resp = await postJson("/api/faucet", {
      address: "a".repeat(60) + "; rm",
    });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });

  await test("POST with valid hex address format accepted", async () => {
    const validAddr = "a".repeat(64);
    const resp = await postJson("/api/faucet", { address: validAddr });
    // Should be 200 (success), 500 (faucet failed), or 503 (not configured)
    // NOT 400 (address should pass validation)
    assert(
      [200, 500, 503].includes(resp.status),
      `Expected 200/500/503, got ${resp.status}`
    );
  });

  await test("Invalid JSON returns 400", async () => {
    const resp = await fetch(`${BASE_URL}/api/faucet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    assert(resp.status === 400, `Expected 400, got ${resp.status}`);
  });
}

// ─── Security Header Tests ──────────────────────────────────────

async function testSecurityHeaders() {
  console.log("\n── Security Headers ───────────────────────────────");

  await test("API responses have X-Content-Type-Options", async () => {
    const resp = await getJson("/api/node");
    const header = resp.headers.get("x-content-type-options");
    assert(header === "nosniff", `Expected 'nosniff', got '${header}'`);
  });

  await test("API responses have X-Frame-Options", async () => {
    const resp = await getJson("/api/node");
    const header = resp.headers.get("x-frame-options");
    assert(header === "DENY", `Expected 'DENY', got '${header}'`);
  });

  await test("API responses have Referrer-Policy", async () => {
    const resp = await getJson("/api/node");
    const header = resp.headers.get("referrer-policy");
    assert(
      header === "strict-origin-when-cross-origin",
      `Expected 'strict-origin-when-cross-origin', got '${header}'`
    );
  });
}

// ─── Rate Limit Tests ───────────────────────────────────────────

async function testRateLimiting() {
  console.log("\n── Rate Limiting ──────────────────────────────────");

  await test("Node route eventually returns 429 under heavy load", async () => {
    // Send 65 rapid requests (limit is 60/min)
    const results: number[] = [];
    for (let i = 0; i < 65; i++) {
      const resp = await postJson("/api/node", { method: "get_status", params: [] });
      results.push(resp.status);
      // Consume body to free connection
      await resp.text();
    }
    const has429 = results.includes(429);
    assert(has429, `Expected at least one 429 in ${results.length} requests, got statuses: ${[...new Set(results)].join(", ")}`);
  });

  await test("429 response includes Retry-After header", async () => {
    // After the previous test, we should already be rate limited
    const resp = await postJson("/api/node", { method: "get_status", params: [] });
    if (resp.status === 429) {
      const retryAfter = resp.headers.get("retry-after");
      assert(retryAfter !== null, "429 must include Retry-After header");
      assert(parseInt(retryAfter!, 10) > 0, "Retry-After must be positive");
    }
    await resp.text();
    // If not 429, rate limit already cleared (still a pass)
  });
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log(`\nTonkl Security Tests`);
  console.log(`Target: ${BASE_URL}\n`);

  // Check server is reachable
  try {
    await fetch(`${BASE_URL}/api/node`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(`ERROR: Cannot reach ${BASE_URL}. Is the dev server running?\n`);
    process.exit(1);
  }

  await testNodeRoute();
  await testWalletRoute();
  await testFaucetRoute();
  await testSecurityHeaders();
  await testRateLimiting();

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);
  console.log(`${"═".repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
