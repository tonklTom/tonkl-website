# Tonkl Website and Shlem Security Risk Register

Date: 2026-05-11

Scope:
- `tonkl-website`: Next.js app, wallet API routes, Shlem API route, local wallet command bridge
- Shlem integration points used by the website
- Cross-repo references where protocol/node behavior affects website safety

This register tracks the risks still open after the May 2026 hardening pass. It is written so each item can become a GitHub issue.

## Severity

| Severity | Meaning |
| --- | --- |
| P0 Critical | Can permit forged state, fund loss, full consensus bypass, or exposure of critical secrets in beta/public environments. |
| P1 High | Material security issue that should be fixed before beta, but requires a second condition or limited environment to exploit. |
| P2 Medium | Important hardening, privacy, operational, or reliability work that should be scheduled before wider public testing. |
| P3 Low | Tracking, documentation, or cleanup item. |

## Fixed or Validated in This Pass

| ID | Status | Notes |
| --- | --- | --- |
| RESOLVED-001 | Fixed | Website faucet no longer extracts a private spending key from `list-keys`; it uses wallet key-index flow. |
| RESOLVED-002 | Fixed | Website token creation and minting no longer extract token authority secrets; they use authority key-index flow. |
| RESOLVED-003 | Fixed | Wallet CLI JSON outputs used by the website no longer return private scan/spending/authority keys. |
| RESOLVED-004 | Fixed | API route subprocess stdout/stderr pipe guards were added to prevent runtime crashes when streams are unavailable. |
| RESOLVED-005 | Validated | Targeted API route ESLint and TypeScript checks passed after the subprocess guard fixes. |
| RESOLVED-006 | Fixed | Wallet API and wallet-aware Shlem access now require a valid app session before exposing wallet metadata or wallet connector context. |
| RESOLVED-007 | Fixed | Shlem now applies deterministic secret-shape redaction before hosted model prompts, session memory, and learning capture. |

## Open Risks

| ID | Severity | Area | Status | Suggested GitHub Issue |
| --- | --- | --- | --- | --- |
| TONKL-WEB-001 | P1 High | Wallet API auth | Fixed 2026-05-16 | Session-gate wallet and Shlem routes that can access wallet state |
| TONKL-WEB-002 | P1 High | Shlem cloud redaction | Fixed 2026-05-16 | Add deterministic secret-shape redaction before any hosted model call |
| TONKL-WEB-003 | P1 High | Wallet CLI secret args | Open | Remove website dependence on any remaining secret-bearing wallet CLI flags |
| TONKL-WEB-004 | P2 Medium | Session security | Open | Replace sessionStorage bearer token with stronger session handling |
| TONKL-WEB-005 | P2 Medium | Shlem prompt injection | Open | Treat external knowledge as untrusted data in Shlem prompts |
| TONKL-WEB-006 | P2 Medium | Public node proxy reads | Open | Decide and enforce public vs wallet-sensitive read API policy |
| TONKL-WEB-007 | P2 Medium | CI readiness | Open | Fix remaining full lint failures before beta gating |
| TONKL-WEB-008 | P3 Low | Shlem repo tracking | Open | Put Shlem in a git repo or vendor it into a tracked repo |

## TONKL-WEB-001: Wallet and Shlem read APIs are not session-gated

Severity: P1 High

Status: Fixed 2026-05-16

Evidence:
- `src/app/api/wallet/route.ts` now requires a valid app session before returning local wallet summaries or read command output.
- `src/app/api/shlem/route.ts` now blocks wallet-sensitive prompts without a session and only passes wallet command context to Shlem after session validation.
- Wallet UI callers now include `X-Tonkl-Session` for wallet summary, receive address, faucet address lookup, and Shlem wallet-aware requests.

Impact:
- A process or web page able to reach the local app can query wallet state through the local website API.
- Balance, assets, notes, and history are not private keys, but they are sensitive wallet metadata.

Recommendation:
- Require a valid session for wallet routes.
- Require a valid session for Shlem whenever wallet or node connector context is enabled.
- Allow unauthenticated Shlem only for pure public/help mode with no wallet command configured.

Acceptance criteria:
- Unauthenticated calls to wallet summary return 401.
- Shlem wallet-aware calls return 401 without session.
- Public help-only Shlem mode is explicitly separated from wallet-aware mode.
- Security tests assert unauthenticated wallet and faucet calls are rejected before connector execution.

## TONKL-WEB-002: Shlem cloud model redaction is keyword-based, not secret-shape based

Severity: P1 High

Status: Fixed 2026-05-16

Evidence:
- Shlem now redacts model input and JSON context using deterministic secret-shape checks.
- Covered shapes include BIP-39-like mnemonic word counts, raw 32-byte hex strings with or without `0x`, passphrase assignments, and secret-shaped JSON keys.
- The same redaction helpers are also used before session memory and learning capture.

Impact:
- User secrets could be sent to a hosted Llama provider during fallback/model generation.
- This is especially risky because Shlem is a wallet assistant and users may paste recovery material while asking for help.

Recommendation:
- Add deterministic pre-model scanning for:
  - BIP-39-like 12/15/18/21/24 word sequences
  - `0x` plus 64-hex strings
  - raw 64-hex strings near wallet/action context
  - common private key, seed, passphrase, and authority-key formats
- Redact before memory, logs, learning examples, or model calls.
- Add tests proving secrets never enter the model provider request.

Acceptance criteria:
- Model provider tests fail if mnemonic-shaped text, raw 32-byte hex, or secret JSON fields reach outbound payload text.
- Safety layer blocks pasted mnemonic-shaped recovery text and passphrase assignments before model execution.

## TONKL-WEB-003: Remaining wallet CLI secret arguments are still dangerous integration points

Severity: P1 High

Evidence:
- The website now avoids the worst key extraction patterns for faucet and token flows.
- The underlying wallet CLI still supports secret-bearing argv flags in manual and integration paths.

Impact:
- Future website edits could accidentally reintroduce secret extraction or argv secret passing.
- Manual beta workflows can still leak secrets through shell history or process lists.

Recommendation:
- Keep website routes on key-index, stdin, env, or encrypted-wallet flows only.
- Add route-level assertions that reject `--to-sk`, `--from-sk`, `--authority-sk`, `--recipient-sk`, `--passphrase`, and mnemonic words in constructed argv.
- Track the protocol-side CLI cleanup under `TONKL-SEC-004`.

Acceptance criteria:
- API tests assert no constructed command contains secret-bearing wallet flags.
- Security scan blocks new website uses of raw private-key flags.

## TONKL-WEB-004: Session token is stored in sessionStorage

Severity: P2 Medium

Evidence:
- `src/lib/client-session.ts` stores the session token in browser `sessionStorage`.
- `src/lib/session.ts` uses an in-memory server store with a 24-hour TTL.

Impact:
- XSS or browser extension compromise can read the bearer token.
- Server restarts invalidate sessions and there is limited revoke/logout behavior.

Recommendation:
- Prefer HttpOnly, SameSite cookies for app sessions.
- Add a logout endpoint that revokes server-side session state.
- Shorten TTL for beta and bind sessions to wallet address plus nonce.
- Add a strict Content Security Policy before public beta.

Acceptance criteria:
- Wallet API routes authenticate through HttpOnly cookie or equivalent server-owned token.
- Logout invalidates server-side session immediately.

## TONKL-WEB-005: Shlem external knowledge can become prompt-injection input

Severity: P2 Medium

Evidence:
- Shlem can fetch curated web knowledge and inject it into the prompt context.
- External data, even from curated APIs, can include names/descriptions that look like instructions.

Impact:
- A malicious token/protocol description could try to steer the model during wallet assistance.

Recommendation:
- Mark external knowledge as untrusted data only.
- Strip or neutralize instruction-like phrases before prompt assembly.
- Disable external web knowledge during wallet write previews and sensitive flows.

Acceptance criteria:
- External knowledge is wrapped in a data-only section and cannot override system safety rules.
- Tests cover injection-like protocol names/descriptions.

## TONKL-WEB-006: Public node proxy read policy needs tightening

Severity: P2 Medium

Evidence:
- `src/app/api/node/route.ts` proxies selected node reads including encrypted notes and metadata-heavy chain data.

Impact:
- Public scraping can support timing and wallet metadata inference.

Recommendation:
- Decide which reads are public explorer features.
- Session-gate wallet-sensitive reads.
- Keep strict method allowlists, request caps, and rate limits.

Acceptance criteria:
- Public read endpoints are documented and rate-limited.
- Wallet-sensitive reads require an authenticated local session.

## TONKL-WEB-007: Full lint is still red

Severity: P2 Medium

Evidence:
- Targeted API route lint passes.
- Full `npm run lint` still fails in unrelated UI/test files, including `src/components/ui/pixel-trail.tsx` and `tests/security-tests.ts`.

Impact:
- CI cannot be used as a reliable beta gate while full lint is red.

Recommendation:
- Fix unrelated UI/test lint errors.
- Add security scans to CI after lint is clean.

Acceptance criteria:
- `npm run lint` exits 0.
- `npx tsc --noEmit` exits 0.

## TONKL-WEB-008: Shlem is not currently tracked in git

Severity: P3 Low

Evidence:
- `/Users/ashleycole/Desktop/Shlem` is not a git repository.

Impact:
- Shlem fixes and audit notes cannot be pushed unless Shlem is moved into a repo, added as a submodule, or copied into a tracked project.

Recommendation:
- Decide whether Shlem should be:
  - a standalone `tonkl-shlem` repo,
  - a package inside `tonkl-website`,
  - or a package inside `tonkl-protocol`.

Acceptance criteria:
- Shlem source and tests are tracked in GitHub before beta.

## Suggested GitHub Issue Split

Create these issues in `tonklTom/tonkl-website`:

1. `[P1] Session-gate wallet and wallet-aware Shlem API routes`
2. `[P1] Add deterministic secret-shape redaction before Shlem model calls`
3. `[P1] Add website guards against secret-bearing wallet CLI argv`
4. `[P2] Move app sessions away from sessionStorage bearer tokens`
5. `[P2] Treat Shlem external knowledge as untrusted prompt data`
6. `[P2] Define public vs wallet-sensitive node proxy reads`
7. `[P2] Fix full lint before beta CI gating`
8. `[P3] Put Shlem source under GitHub tracking`

## Recheck Commands

Recommended local checks after fixes:

```bash
cd ~/Desktop/tonkl-website
npm run lint
npx tsc --noEmit
rg "--to-sk|--from-sk|--authority-sk|--recipient-sk|--passphrase|spending_sk|authority_sk|sessionStorage|SHLEM_WALLET_CMD" src tests
```
