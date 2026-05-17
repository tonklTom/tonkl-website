#!/usr/bin/env npx tsx

import { maskSecretText } from "../src/lib/secret-mask";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
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

console.log("\nTonkl Secret Mask Tests\n");

test("masks labelled seed phrase", () => {
  const result = maskSecretText(
    "seed phrase is abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  );
  assert(result.masked, "Expected text to be masked");
  assert(!result.text.includes("abandon"), "Seed words must not remain visible");
});

test("masks bare 12-word recovery phrase", () => {
  const result = maskSecretText(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  );
  assert(result.masked, "Expected bare phrase to be masked");
  assert(result.text === "[hidden recovery phrase]", "Expected full phrase replacement");
});

test("masks labelled private key", () => {
  const result = maskSecretText(`private key is 0x${"a".repeat(64)}`);
  assert(result.masked, "Expected key to be masked");
  assert(!result.text.includes("a".repeat(32)), "Private key material must not remain visible");
});

test("masks passphrase assignments", () => {
  const result = maskSecretText("wallet passphrase is swordfish");
  assert(result.masked, "Expected passphrase to be masked");
  assert(!result.text.includes("swordfish"), "Passphrase must not remain visible");
});

test("does not mask public recipient address request", () => {
  const address = `0x${"b".repeat(64)}`;
  const result = maskSecretText(`send 5 TNKL to ${address}`);
  assert(!result.masked, "Public address should remain visible");
  assert(result.text.includes(address), "Address should remain in visible text");
});

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
