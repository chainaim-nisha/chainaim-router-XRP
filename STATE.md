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

## 2026-10-23 — L0 (signer-based payments + multi-tenant rig): code done, TestNet run pending

- Done (details and test output in BUILD_LOG.md, same date): `payAndFetch` pays through a signer and checks network, payment and signature before sending; `--seed-prefix` on pay.ts and private-ask.ts; `scripts/rig.ts` + `rig-core.ts` with three synthetic tenants in `rig/tenants/`; 19 new tests. Paywall 75/75 and web 105/105 on a Linux copy of 568509f.
- Next (owner): `npm install` in `services/paywall` on this PC and `npm test` there; then MANUAL_SETUP.md 2026-10-23 steps 1 to 5 for t01..t03. L0 passes at "settled 30 of 30" and 30 `payment_settled` lines from three payers.
- Next (agent, after L0 passes): L2, a KMS Ed25519 signer that implements the same `XrplSigner` in `scripts/signer.ts`.
- Open: no ARCH-ID for the rig (tests named `L0-RIG`).
- Owner run on this PC, 10:41 IST: `npm install` + `npm test` in `services/paywall`: 75/75 pass.
- Tenant wallets (TestNet, public addresses; seeds in the owner's password manager and `.env` as `XRPL_SEED_T0n_TESTNET`). Each funded with 100 XRP through the faucet API, then `trust-line.ts` opened its RLUSD line:

| Tenant | Address | RLUSD trust line tx |
|---|---|---|
| t01 | `rNyKVsrK82yU4v5WBxfAjq3Nk7Ls9oVF8U` | `9C6F39D39C642D9BA1C3097E09EF103D51691A0A96F80B548EAE3F2FAEE1FA86` |
| t02 | `rD59tmENJNnHovdi4hKq79DVP4gnDNFGWk` | `7A98E7629392B2C36109E4636DFCC6D75A3ECA5F2E8DD0F14AF5AD3F625DF3E3` |
| t03 | `rKSZJdBpp1vDpqYWbaDFKWDecwSMmmGA1B` | `2C03942CE90E6141BBDEC4812C770605A1DA92BBD744D783D5EFED6E5A5DEBEB` |

- Note for PowerShell: read a tenant seed for one command with Node's own .env parser (the same one the scripts use), never by pasting: `$env:XRPL_BUYER_SEED_TESTNET = node -e "process.loadEnvFile('../../.env'); process.stdout.write((process.env.XRPL_SEED_T01_TESTNET||'').replace(/['\x22]/g,'').trim())"`, then the script, then `Remove-Item Env:XRPL_BUYER_SEED_TESTNET`.
- RLUSD: 0.5 to each tenant from the owner's Crossmark account `rn4QHduCAXzkEgC1nPdUno5rWfxZarJw1a` (11:16–11:35 IST). Txs: t01 `3D33BDE835D9269133671D86F2F81384A7AD032184B99CDE4E4CF0BCF425C1F0`; then, in the order sent (t02, t03 assumed from that order): `A9ACA8026BAB2856F922353E3A8E120895742EFE6D7665F4F7144CC0E8581C39`, `9F0E7D0BFEF2CEE0126684F3C0ADC4699523E31CFD252F81544C5A03FC43D2EB`. Checked with `trust-line.ts` (read only): each tenant `XRP 99.999988; RLUSD trust line open, balance 0.5`.
- Rig dry run (11:37 IST): passed. Stack up (`ca-paywall`, `ca-gateway`, `ca-presidio` healthy, `ca-openrouter-stub`); price 0.01 RLUSD on xrpl:1 to `rn5hSy7QvsrQLpGb3k5dp4h8Yrk9J7gBej`.
- **BLOCKER (11:40–11:51 IST): the paywall cannot reach the t54 facilitator from this PC's current network.** Every paid call came back HTTP 402; after `payAndFetch` was taught to report the paywall's reason, it read `fetch failed`. `Invoke-RestMethod https://xrpl-facilitator-testnet.t54.ai/supported` from the host: "Could not establish trust relationship for the SSL/TLS secure channel"; the same fetch from inside `ca-paywall`: `SELF_SIGNED_CERT_IN_CHAIN`. A TLS-inspecting proxy or antivirus re-signs `*.t54.ai` (as noted for Sophos earlier). No payment was verified or settled: every tenant still holds 0.5 RLUSD. `FACILITATOR_URL_TESTNET` is unset in the container (default t54 TestNet URL). Fix is the network, not the code; TLS verification must not be switched off.
- Code change made while diagnosing: `payAndFetch` returns `refusal` (the x402 `error` in the paywall's PAYMENT-REQUIRED header); the rig records it, `pay.ts` prints it; new test. Paywall 76/76 on this PC.
- Diagnosis (11:56–11:59 IST): the re-signing CA is `Sophos / Sophos SSL CA_C44316162989-HI1GIG`; the PC was on wired Ethernet and has no Sophos services, so the interception is a Sophos Firewall on the wired LAN (inference from the CA name and the absence of local Sophos). On Wi-Fi (12:06 IST) `ca-paywall` reached t54: `/supported` lists `exact` and `upto` on `xrpl:1` (no `batch-settlement` now, unlike 21 Oct).
- **First settlements through the signer path (12:06 IST):** t01 `A5C1A5E1D2F5E0D7AC437C66D39D20A49ACB712BDC9DB21CA8E16AACA208150E`, t02 `891CE866F7250588DE80567098A5FF4FCC9E8555B3F36598EA0E12CC10F65383`, t03 `14C4C87E2B3CDBC9CD77B19AD247ECAB41C163534598DAE08F8B552713A690D7` (0.01 RLUSD each, HTTP 200). Calls 2–10 of every tenant failed before signing with "the XRP Ledger server did not answer" (no payment made): the web page's reader opened a new WebSocket per ledger read (4 per payment, 3 tenants at once), which the public TestNet server stopped answering (likely cause, inferred).
- Fix: `ledgerOverClient` / `withLedger` in `scripts/xrpl.ts` (one xrpl.js connection; server error codes kept); `payAndFetch` opens one per call by default; the rig keeps one per tenant for the whole run. 3 new tests; paywall 79/79 on the Linux copy.
- **L0 PASSED (12:11 IST, Wi-Fi):** `npm test` 79/79 on this PC; `node scripts/rig.ts --url http://127.0.0.1:8080 --calls 10` → `settled 30 of 30`, every tenant `settled 10, not settled 0, refused 0, errors 0, spent 0.1 RLUSD`. Records: `rig/out/run-2026-10-23T06-41-04-086Z.jsonl` (30 transaction hashes, one per call). First and last per tenant: t01 `FC96CC05B43CF989D18108226ACF7B4327967E8AC4757D6956BD45B49D4B399F` … `4A87CDC196D3108439A03DA76783C4475FCE4B9C73A7A79C0594F99CD16A8EC4`; t02 `F82A9B6F0C6E08C1CD24DC8A45609F8556403865AE20366AE68BBA848F582923` … `F728B1468FCB05782D9CA4ACB8F1CDADEDD77CD92DFB3412920F72A9A4F3D727`; t03 `FC8134C68E22CAD55B846CC00095B11AC50726819D77F1C3DA0C6ED535845D4C` … `3F12C7AA9D50C6A78AB7A08D555340250BE6104FBF0FA1928CD55ED5E93293E1`. Expected balances now 0.39 RLUSD per tenant (0.5 − 0.01 from the 12:06 run − 0.10). Cross-checked 12:14 IST: `docker logs ca-paywall --since 30m` shows 11 `payment_settled` lines for each of the three payers = 10 from this run + 1 from the 12:06 run; nothing else settled.
- Next (agent): L2, a KMS Ed25519 signer implementing the same `XrplSigner` (`scripts/signer.ts`). Long term (owner): ask IT to exclude `*.t54.ai` from the Sophos Firewall's HTTPS inspection, or keep running on Wi-Fi.

## 2026-10-23 — L1 (buyer agents on Strands + Bedrock): code done, PC test and Bedrock run pending

- Order changed by the owner: L1 before L2 (L2 waits on AWS KMS access).
- Done (details in BUILD_LOG.md, same date): `agent.ts` / `agent-core.ts` (one tool, `chainaim_private_ask(file, question)`), shared `private-ask-core.ts`, `private-ask.ts` thinned onto it, `test/agent.test.ts` (11 tests), tenant docs in `rig/tenants/t0n/docs/`, Strands SDK 1.20.0 + zod 4.6.7 in `package.json`. 90/90 on the Linux copy.
- Note: an earlier draft of `agent-core.ts` and `agent.ts` was already on the PC at 12:46 IST from an earlier session; it was compared byte for byte, kept (agent-core) and rewritten (agent.ts, 1 byte different).
- Next (owner): MANUAL_SETUP.md "2026-10-23 — buyer agents (L1)" steps 1 to 4. L1 passes at one answered, settled tool call from a tenant agent, with the model's inputs holding only masked text (the tests check that last part).
- Next (agent, after L1 passes): L2, KMS Ed25519 signer.
- Open: no ARCH-ID for L0 or L1.
