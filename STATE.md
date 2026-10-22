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

## 2026-10-21 — TestNet proof (owner run, repo `chainaim-router`, branch `integrate-xrpl`)

Run by the owner on the CPU-only Windows PC, steps given one at a time by Claude. Evidence is the command output quoted in that session; public addresses and hashes only, no seeds.

**Gap 1 closed: a real payment settled.**
- `node scripts/pay.ts http://127.0.0.1:8080/v1/privacy/scan --text "Patient Jane Roe, MRN 991122, was diagnosed with diabetes."` → `HTTP 200`, real Presidio scan result (dataClass PHI), `payment {"success":true,"transaction":"E55B67292C6DAFE7CC07060477FA5E65E38DCFCE8257AD8B0D5590EF8BE8400A","network":"xrpl:1",...}` with a t54 attestation extension (`environment rewards-testnet`, `nonProduction true`, `status ready`).
- `docker logs ca-paywall` → `payment_settled`, `POST /v1/privacy/scan`, amount `0.01`, asset RLUSD, `xrpl:1`, the same transaction.
- testnet.xrpl.org → Payment 0.01 RLUSD (issuer `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`) from the buyer to payTo, SourceTag `804681468`, ledger 21715209, 2026-10-21 18:26:01 UTC.
- So t54 accepts the `@x402/core` verify/settle body, and `/supported` lists `exact` on `xrpl:1`.

**Gap 4, Open Question 3 closed:** `https://xrpl-facilitator-testnet.t54.ai/supported` answered from the host and from inside `ca-paywall` with kinds `exact`, `upto`, `batch-settlement` on `xrpl:1`. The Sophos re-signing does not apply on this PC's network (it may still apply on the network where it was first seen). Open Question 4 (Bazaar listing on t54) is still not checked.

**Gap 3 closed for `new-account.ts`, `trust-line.ts`, `pay.ts`:** all ran to success on funded TestNet accounts. `send-xrp.ts` and `private-ask.ts` were not run.

**Gap 2 narrowed, not closed:** the Crossmark extension (TestNet) signed and submitted a plain 1 RLUSD Payment to the buyer. The ChainAim web page adapter (`services/web`, Connect Crossmark → Execute) has still never run in a browser.

Accounts (TestNet, public addresses):

| Role | Address | State |
|---|---|---|
| payTo (in `ca-paywall` as `XRPL_PAY_TO_TESTNET`) | `rn5hSy7QvsrQLpGb3k5dp4h8Yrk9J7gBej` | 100 XRP from faucet (tx `A37CC8A9F3F327078FAD1ADC3F316A1F7FD44988F70FD1251C7BECE4D6F80EA0`), RLUSD trust line (tx `923754D08B8D09A123F869255AEE6377A0339517373B723E09E7939A6DBB47FB`), received 0.01 RLUSD |
| Buyer for `pay.ts` | `rMosbGSCHTWnZmdgyhVETxSDRdPnormKxR` | 100 XRP from faucet (tx `025715056DA029AFC9B9169FC87884D56D4FB563CCBBB3850AFAED628FCC0EB8`), RLUSD trust line (tx `B0BA7C9E909055846FA574805E14F137D1713BCB9999C6A90E3171977D59E4B8`), got 1 RLUSD from Crossmark, paid 0.01 |
| Owner's Crossmark account | `rn4QHduCAXzkEgC1nPdUno5rWfxZarJw1a` | Holds RLUSD; sent 1 RLUSD to the buyer |
| Owner's other account | `rnfBRWuxpLnFaQUbAAjgZ1szhzRUSsPkGU` | Held 5.03 RLUSD when checked; not used |

Seeds are in the owner's password manager only.

Notes found on the way:
- The XRPL faucet web page did not fund the existing payTo address; the faucet API did: `POST https://faucet.altnet.rippletest.net/accounts` with `{"destination":"r...","userAgent":"xrpl.js"}` (host and path from `xrpl/dist/npm/Wallet/defaultFaucets.js`, body from `client/index.js` `fundWallet`).
- `new-account.ts` makes Ed25519 keys: the family seed starts `sEd` and is 31 characters.
- The scripts load the repository `.env` through `src/env.ts`; a value set in the shell wins. The services do not read `.env`.
- `ca-paywall` was recreated from image `chainaim-paywall:test` with `-e XRPL_NETWORK=testnet -e XRPL_PAY_TO_TESTNET=... -e GATEWAY_URL=http://gateway.railway.internal:8700 -e CHAINAIM_GATEWAY_KEY` on network `chainaim-test`; `RUN-ON-ANOTHER-PC.md` step 6 still shows the old Algorand `docker run` and needs this update.
- A test console process started before the merge showed the price as `1e-8` with no issuer or invoice; after restarting it the 03 Payment section shows 0.01 RLUSD, the issuer, payTo and the invoice.

Still open: the Crossmark web page payment; Open Question 4 (Bazaar); `RUN-ON-ANOTHER-PC.md` step 6 update; committing the untracked CPU config files; merging `integrate-xrpl` into `main` (nothing pushed).
