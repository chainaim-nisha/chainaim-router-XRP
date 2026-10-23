# BUILD LOG

Append-only. Spec: `architecture-xrpl-migration.md`. All output below is from commands run on 2026-10-13.

## Baseline, before any edit

```
gateway   npm test (repo root)            tests 266  pass 266  fail 0
web       npm test (services/web)         tests 87   pass 87   fail 0
paywall   npm ci && npm test              tests 46   pass 46   fail 0
```

## Stage 0 — blockers (Open Questions 1 and 2)

- `x402-xrpl@0.3.3`: Express middleware only; `x402Fetch` reads the price from the 402 response **body**, which `@x402/hono` leaves empty (it sends the price in the `PAYMENT-REQUIRED` header). `x402Fetch` therefore cannot pay this paywall. The scripts use the SDK's `decodePaymentRequiredHeader` and `XRPLPresignedPaymentPayer` instead.
- `@x402/xrpl@2.27.0` (same version line as the pinned `@x402/core` and `@x402/hono`) provides `ExactXrplScheme` for `x402ResourceServer`, so the existing `paymentMiddleware` stays (ARCH-017).
- `curl -D -` against `https://s.altnet.rippletest.net:51234/` and `https://s1.ripple.com:51234/`: no `Access-Control-Allow-Origin`. A page cannot `fetch` them, so the browser reads the ledger over WebSocket (ARCH-015).
- `*.t54.ai`: `SELF_SIGNED_CERT_IN_CHAIN` (Sophos certificate). The facilitator was never reached.

## Stages 1, 3, 4 — paywall (ARCH-010 to ARCH-014, ARCH-017)

Changed: `src/config.ts`, `src/routes.ts`, `src/app.ts`, `scripts/pay.ts`, `scripts/new-account.ts`, `scripts/private-ask.ts` (paying block only), `test/config.test.ts`, `test/paywall.test.ts`, `test/pay.test.ts`, `test/private-ask.test.ts`, `test/stubs.ts`, `package.json`, `package-lock.json`.
Added: `src/invoices.ts`, `scripts/xrpl.ts`, `scripts/trust-line.ts`, `scripts/send-xrp.ts`.
Deleted: `src/replay.ts`, `scripts/opt-in.ts`, `scripts/send-algo.ts`.
Dependencies: removed `@x402-avm/extensions`, `@x402/avm`, `@algorandfoundation/algokit-utils`, `@x402/fetch`; added `@x402/xrpl` 2.27.0, `@x402/extensions` 2.27.0, `ripple-address-codec` 5.0.1, dev `xrpl` 4.7.0, dev `x402-xrpl` 0.3.3.

```
> node --test --test-force-exit "test/*.test.ts"
✔ client-mask  ✔ loadConfig  ✔ paid routes  ✔ scripts/pay.ts  ✔ paywall (TestNet)
✔ paywall invoices (ARCH-013, ARCH-014)  ✔ paywall (MainNet)  ✔ main  ✔ scripts/private-ask.ts
tests 56  suites 9  pass 56  fail 0
```

Scripts against the real XRPL TestNet with a throwaway, unfunded key (nothing submitted):

```
new-account: address rPgU1bWXTVsYE8TMsBzBr48CxfAupXnM6U | seed shape ok: true
trust-line (unfunded)   exit 1  This account is not on TestNet yet. Fund this address at ..., then run this again.
trust-line (bad limit)  exit 2  "-5" is not a positive amount of RLUSD
send-xrp (no args)      exit 2  usage: node scripts/send-xrp.ts RECEIVER_ADDRESS [XRP]
send-xrp (bad address)  exit 2  RECEIVER_ADDRESS is not a valid XRP Ledger address (wrong characters or checksum)
send-xrp (unfunded)     exit 1  The sender is not on TestNet yet. Fund it at ...
pay (unfunded buyer)    exit 2  the buyer account r... is not on testnet yet: fund it with XRP and open its RLUSD trust line first; nothing was paid
```

Production-only install, as the Dockerfile does (`npm ci --omit=dev`, 48 packages), then `node src/main.ts`:

```
GET /                 -> 200 ... every answer is paid per call in RLUSD on the XRP Ledger with x402.
POST /v1/privacy/scan -> 402 {"scheme":"exact","network":"xrpl:1","amount":"0.01","asset":"524C555344000000000000000000000000000000","payTo":"rwaugYNb1VYhPVhV3oEa77Pa9itayatbJd","maxTimeoutSeconds":600,"extra":{"issuer":"rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV","invoiceId":"D0A512AD937A4705B4E126CFACAE2C67","sourceTag":804681468,"areFeesSponsored":false}}
```

## Stage 5 — web, with Crossmark (ARCH-015, ARCH-016)

Changed: `src/pay.ts`, `src/balance.ts`, `src/wallets.ts`, `src/wallet-entry.ts`, `src/app.ts`, `src/answer.ts`, comments in `src/config.ts`, `src/main.ts`, `src/relay.ts`, `scripts/build-wallet.ts`, `public/index.html`, `public/cookies.html`, `public/wallet.js` (rebuilt, 527 KB to 65 KB), `README.md`, `package.json`, `package-lock.json`, and the tests `pay`, `balance`, `wallets`, `app`, `answer`, `legal`, `vercel-build`.
Added: `src/crossmark-signer.ts`, `src/xrpl-payment.ts`, `test/crossmark-signer.test.ts`, `test/xrpl-payment.test.ts`.
Deleted: `src/lute-signer.ts`, `src/buffer-shim.ts`, `test/lute-signer.test.ts`.
`src/relay.ts`: no header change needed, as the spec expected.

```
> node --test --test-force-exit "test/*.test.ts"
tests 103  suites 23  pass 103  fail 0
```

Cross-service run: real web app and relay, real paywall, live TestNet reads; the facilitator and gateway are the test doubles, and an offline xrpl.js key signs in place of Crossmark:

```
issuer account balance: { xrp: 99.957946, rlusd: 0, trustLineOpen: false }
never-funded address:   { xrp: 0, rlusd: 0, trustLineOpen: false }
unknown command -> LedgerError unknownCmd        dead server -> LedgerError unreachable
prepared from live readings: { Sequence: 611816, Fee: '10', LastLedgerSequence: 21501561 }
GET /api/wallets -> { network: 'testnet', caip2: 'xrpl:1', wsUrl: 'wss://s.altnet.rippletest.net:51233/', asset: '524C5553...', issuer: 'rQhWct2f...', payTo: { address: 'rwaugYNb...' }, prices: { chat: 0.01 } }
payWith -> relay -> paywall: facilitator calls [ '/verify', '/settle' ], receipt TX-STUB-1 returned to the page
payment headers at gateway: []          (ARCH-005)
paywall payment log: {"event":"payment_settled","route":"POST /v1/chat/completions","amount":"0.01","asset":"524C5553...","network":"xrpl:1",...}
```

## Stage 6 — sweep and documentation (ARCH-018)

Updated: `.env.example`, `README.md`, `SETUP.md`, `ONBOARDING.md`, `PROJECT_CONTEXT.md`, `docs/deploy/railway.md`, `docs/deploy/vercel.md`, `docs/setup-end-to-end.md`, `test-console/console/server.ts` (a third `amount / 1e6`), `test-console/console/index.html`.

Final run of every suite:

```
gateway  tests 266  pass 266  fail 0
paywall  tests 56   pass 56   fail 0
web      tests 103  pass 103  fail 0
find services/gateway services/presidio packages/route-engine config -newer architecture-xrpl-migration.md -type f   ->  (nothing)   ARCH-002
```

## 2026-10-23 — L0: payments through a signer, and the multi-tenant test rig

Why: the plan's first layer (L0) needs several buyer wallets paying in a loop, and the payment code must take any signer (seed now, AWS KMS next) instead of an xrpl.js Wallet.

Changed:
- `services/paywall/scripts/xrpl.ts`: `payAndFetch(url, init, buyer, { ledger?, maxAmount? })` now takes a `Buyer` with a signer. It builds the Payment with `services/web/src/xrpl-payment.ts` (`preparePayment`, `paymentHeader`, `decodeRequired`), reads the ledger with `services/web/src/balance.ts` (`ledgerOverWebSocket`), and before anything is sent checks that the ledger server is on the paid network (as the x402-xrpl SDK payer does), that the signed blob is exactly the prepared Payment from the buyer's account, and that its signature verifies. `maxAmount` refuses a price above a ceiling before signing. `account(env, { seedPrefix })` reads `PREFIX_TESTNET`/`PREFIX_MAINNET`. Exact decimal helpers `decimalUnits`, `unitsToDecimal`.
- `scripts/pay.ts`, `scripts/private-ask.ts`: `--seed-prefix` (default `XRPL_BUYER_SEED`, so behaviour without the flag is unchanged).
- New: `scripts/signer.ts` (`seedSigner`), `scripts/rig-core.ts`, `scripts/rig.ts`, `rig/README.md`, `rig/tenants/t01..t03` (synthetic texts), tests `test/signer-pay.test.ts`, `test/rig.test.ts`.
- `.env.example` (`XRPL_SEED_T01..T03_TESTNET`), `.gitignore` (`rig/out/`), `MANUAL_SETUP.md` (2026-10-23 section).

Verification note: the SDK payer (`x402-xrpl` 0.3.3, `XRPLPresignedPaymentPayer`, read in `dist/index.js`) and `preparePayment` set the same fields (Amount = SendMax, Memo + InvoiceID binding by default, SourceTag, LastLedgerSequence = validated + ceil(maxTimeout/5) + 2, fee cap). Differences: the fee comes from `fee.open_ledger_fee` instead of `autofill`; the network check was added here so the new path is no weaker.

Run on a Linux copy of this commit (568509f) with Node v22.22.0, `npm ci` then `npm test` in `services/paywall` and `services/web`; the agent has no shell on the owner's PC, so these have not yet been run there:

```
paywall (before the change)  tests 56   pass 56   fail 0
paywall (after)              tests 75   pass 75   fail 0   suites 15
  ok rig tenants · ok runTenant against a stub paywall · ok seedSigner (ARCH-016)
  ok account and seed prefixes (ARCH-011) · ok decimal amounts (ARCH-004)
  ok payAndFetch through a signer (ARCH-016) · all 9 earlier suites ok
web (unchanged)              tests 105  pass 105  fail 0
```

Gap: no ARCH-ID covers the test rig (architecture-xrpl-migration.md ends at ARCH-018); its tests are named `L0-RIG`. The owner should add a requirement for it.

Run by the owner on the Windows PC, 2026-10-23 10:41 IST, in `services/paywall`: `npm install` (49 packages; npm reports 1 moderate advisory, unchanged lockfile, not addressed) then `npm test`:

```
tests 75  suites 15  pass 75  fail 0  cancelled 0  skipped 0  todo 0  duration_ms 8222
```

Fixes found on the real run (same day), both with tests:
- `payAndFetch` returns the paywall's refusal reason (x402 `error` in PAYMENT-REQUIRED); it read `fetch failed`, traced to a Sophos Firewall re-signing `*.t54.ai` on the wired LAN (`SELF_SIGNED_CERT_IN_CHAIN`). Not a code fault; the run moved to Wi-Fi. TLS verification was not switched off.
- Ledger reads moved from one WebSocket per read (the web page's `ledgerOverWebSocket`) to one xrpl.js connection (`ledgerOverClient`, `withLedger`), one per tenant in the rig: the public TestNet server stopped answering the per-read connections after the first payment of each tenant.

Owner run on the Windows PC, 2026-10-23 12:11 IST, Wi-Fi, in `services/paywall`:

```
npm test                                              tests 79  suites 16  pass 79  fail 0
node scripts/rig.ts --url http://127.0.0.1:8080 --calls 10
  t01 rNyKVsrK82yU4v5WBxfAjq3Nk7Ls9oVF8U: settled 10, not settled 0, refused 0, errors 0, spent 0.1 RLUSD
  t02 rD59tmENJNnHovdi4hKq79DVP4gnDNFGWk: settled 10, not settled 0, refused 0, errors 0, spent 0.1 RLUSD
  t03 rKSZJdBpp1vDpqYWbaDFKWDecwSMmmGA1B: settled 10, not settled 0, refused 0, errors 0, spent 0.1 RLUSD
  settled 30 of 30
```

L0 is done: 30 real RLUSD payments on TestNet from three buyer wallets, signed through the `XrplSigner` interface, checked before sending, settled by t54. Transaction hashes in `rig/out/run-2026-10-23T06-41-04-086Z.jsonl` and STATE.md.

## 2026-10-23 — L1: buyer agents (Strands, Bedrock), code and tests done; Bedrock run pending

No ARCH-ID covers L1; tests are named `L1-AGENT` with the ARCH-ID of the rule they also hold (ARCH-002, 003, 004, 016).

Files: `scripts/private-ask-core.ts` (new: `readDocument`, `prepareAsk`, `sendAsk`), `scripts/private-ask.ts` (now a thin CLI over it; same flags and output), `scripts/agent-core.ts` (new: `AskSession`, tool `chainaim_private_ask`, `buildAgent`, `resolveDocument`), `scripts/agent.ts` (new CLI), `test/agent.test.ts` (11 tests), `rig/tenants/t0n/docs/*.txt` (synthetic), `package.json` (`@strands-agents/sdk` 1.20.0, `zod` 4.6.7).

Design points: the tool takes a file name and a question, never text; it reads only files inside the tenant's docs folder (links followed, then refused if outside); the model receives ChainAim's answer with placeholders kept; the restored answer goes to the screen only; payments run one at a time per session under `--max-spend`.

SDK calls checked against the installed 1.20.0 type definitions: `tool({ name, description, inputSchema, callback })`, `new Agent({ model, tools, systemPrompt, toolExecutor: 'sequential', printer: false })`, `agent.invoke(prompt, { limits: { turns } })`, `StopReason 'endTurn'`, default Bedrock model `global.anthropic.claude-sonnet-4-6` (`models/defaults.js`).

Agent run on a Linux copy (PC's L0 files plus L1), `npm test` in `services/paywall`:

```
tests 90  suites 18  pass 90  fail 0  cancelled 0  skipped 0  todo 0
```

CLI runs on the Linux copy: `private-ask.ts --file ../../rig/tenants/t02/docs/discharge-note.txt --dry-run` masked `2 PERSON, 1 MEDICAL_RECORD, 1 IN_AADHAAR`, exit 0; `agent.ts` with no `--tenant`, no `--url`, or an unknown tenant: exit 2 each; `agent.ts --tenant t02 --dry-run --prompt ...`: `the agent failed: The security token included in the request is invalid.`, exit 1 (no AWS credentials on the Linux copy). Not yet run: `npm test` on the Windows PC (the docs-folder test uses a directory junction so it needs no admin rights there), and any Bedrock call.

Owner run on the Windows PC, 2026-10-23 ~14:00 IST: `npm install` (added 47, changed 1; 1 moderate advisory, not addressed), `npm test`: `tests 90 pass 89 fail 1`. The failure was the test's own clean-up, not the check: `rmSync` on the junction threw `ERR_FS_EISDIR` ("Path is a directory") on Windows after the outside-the-folder refusal had passed. Fixed by removing the link with `unlinkSync`. Linux copy after the fix: `tests 90 pass 90 fail 0`.

Owner re-run on the Windows PC, 2026-10-23 14:02 IST, `npm test` in `services/paywall`:

```
tests 90  suites 18  pass 90  fail 0  cancelled 0  skipped 0  todo 0  duration_ms 18458
```

Next: Bedrock dry run and paid run (MANUAL_SETUP.md L1 steps 2 to 4).
