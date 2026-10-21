# STATE

**Spec:** `architecture-xrpl-migration.md` (Algorand/USDC → XRPL/RLUSD)
**Updated:** 2026-10-13
**Current stage:** Stages 0, 1, 3, 4, 5 and 6 are done in code and tests. Stage 2 (accounts) and the real-payment proof in Stage 3 are the owner's. Stage 7 (MainNet) is not started.

Evidence for everything below is in `BUILD_LOG.md`. Owner steps are in `MANUAL_SETUP.md`.

## Test status

| Suite | Before | Now |
|---|---|---|
| Gateway (`npm test`, repo root) | 266 pass | 266 pass, untouched |
| Paywall (`services/paywall`) | 46 pass | 56 pass |
| Web (`services/web`) | 87 pass | 103 pass |

## Requirement status

| ARCH-ID | Status |
|---|---|
| ARCH-001 behavioural equivalence | Non-payment tests pass unchanged. Payment tests rewritten for the new rail. |
| ARCH-002 privacy pipeline untouched | No file under `services/gateway`, `services/presidio`, `packages/route-engine` or `config` was modified. |
| ARCH-003 placeholder format | Route descriptions, schemas and examples in `routes.ts` unchanged. |
| ARCH-004 dollar prices | `$0.01` becomes the RLUSD amount `"0.01"`. Three `amount / 1e6` conversions removed: `web/src/wallets.ts`, `paywall/scripts/pay.ts`, `test-console/console/server.ts`. |
| ARCH-005 isolation boundary | Tested: no payment header reaches the gateway. |
| ARCH-010, ARCH-011 configuration | Done, tested. |
| ARCH-012 address checksum | Done, tested (`ripple-address-codec`). |
| ARCH-013 invoices | Done, tested. See "Decisions" 2. |
| ARCH-014 `ReplayGuard` retired | `replay.ts` deleted after reading it in full; its guarantee is kept by `invoices.ts`. |
| ARCH-015 balance and trust line | Done, tested, and run against live TestNet. Over WebSocket, not JSON-RPC (see "Decisions" 4). |
| ARCH-016 browser signer | Done with Crossmark, tested with a stand-in. **Never run in a browser with the real extension.** |
| ARCH-017 Hono middleware | Kept `@x402/hono`, with `@x402/xrpl`'s server scheme. |
| ARCH-018 no residual references | Code, config, tests, scripts and operational docs are clear. Remaining mentions listed under "Left as they are". |

## Gaps — not proven, must be reported

1. **No real payment has settled.** The t54 facilitator was never reached from this machine (Sophos re-signs `*.t54.ai`). Everything between the paywall and the facilitator is tested only against the local test double. Unverified: that t54 accepts `@x402/core`'s verify/settle request body, and that it lists `exact` on `xrpl:1` in `/supported` (the paywall will not quote a price otherwise).
2. **Crossmark was never run.** No browser, no extension. The adapter follows `@crossmarkio/sdk@0.4.0`'s type declarations (`async.detect`, `async.signInAndWait`, `async.signAndWait` → `response.data.txBlob`, `meta.isRejected`). Whether Crossmark signs the prepared transaction without changing its `Sequence`, `Fee` or `LastLedgerSequence` is unverified.
3. **The paying scripts stop at the ledger** for want of a funded account (owner-only, spec section 11): `pay.ts`, `private-ask.ts`, `trust-line.ts`, `send-xrp.ts` were run only up to "account is not on TestNet yet".
4. Open Question 3 (TestNet facilitator URL) and Open Question 4 (Bazaar on t54) are still open. The discovery metadata is still declared, now through `@x402/extensions/bazaar`.

## Decisions taken that differ from the letter of the spec

1. **Paywall SDK.** `@x402/hono` + `@x402/xrpl` instead of a hand-written middleware on `x402-xrpl`. `x402-xrpl` is used by the scripts.
2. **Invoice is claimed at first presentation, not at settlement.** ARCH-013 says "consume it once settlement succeeds". A refused call is never settled, so that wording would let one signed payment be replayed against the free-model quota, which is the hole `ReplayGuard` closed. Claiming at verification keeps the old behaviour.
3. **`x402Fetch` is not used** in `pay.ts`: it reads the price from the 402 body, which is empty here. The SDK's `XRPLPresignedPaymentPayer` is used directly.
4. **Browser ledger reads use WebSocket**, because Ripple's public JSON-RPC servers send no CORS headers. `XRPL_RPC_URL_*` is therefore not read anywhere.
5. **`RLUSD_ISSUER_MAINNET` has no default**, following the caution in spec section 3.4.
6. **Not implemented from ARCH-011:** `XRPL_RPC_URL_*` and `XRPL_TESTNET_FAUCET_URL` (nothing reads them). `XRPL_WS_URL_*` is read by the scripts only; the web page uses the two public servers named in `web/src/balance.ts`.
7. The "pop-up" variant of the sign-timeout message is gone with Lute: Crossmark has no pop-up fallback.

## Left as they are

- `docs/superpowers/**`, `docs/blog/**`, `docs/submission.md`, `docs/demo-video-script*.md`: records of the Algorand build and challenge entry.
- `packages/route-engine/**`: protected by ARCH-002; its matches are unrelated to this rail.
- `services/web/public/wallet.js`: the word `algo` there is "algorithm" inside the Crossmark SDK.
- "Global x402 Challenge" wording in the page footer and disclaimer. The disclaimer now names "Ripple, the XRPL Foundation" where it named the Algorand Foundation; the owner should review that sentence.

## Environment notes

- `.claude/` does not exist, so no hooks ran and no snapshot was taken. Git was not used.
- `build.config.json` still describes the "shortlink" pilot; the repo has no `typecheck` script.

## Next step

Owner: `MANUAL_SETUP.md`, "Owner steps on TestNet", then one real payment with `scripts/pay.ts`, then one in the browser with Crossmark.
