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

## 2026-10-24 — M1: mask everything that reaches a model (gateway)

Repository: `chainaim-router-private-ai-2` (PC folder; code identical to `chainaim-router-XRP-RLUSD-` main `ab3b178`, checked by file size with CRLF on every file changed).

Bug fixed (verified in code): `openrouter.ts` `shapeBody` copied `tools`, `response_format` and `stop` from the request to the model unscanned; `chat.ts` `prepare` scanned only `messages`. Detection gaps: no bank-account type, no address or date of birth, names only from the NLP model. Nothing re-checked text after masking.

Changed: `services/gateway/src/{chat.ts, openrouter.ts, main.ts, server.ts}`, `privacy/{entities.ts, mask.ts, presidio.ts}`, `scripts/synthetic-corpus.ts` (start-up sentence values for the stub), `PROJECT_CONTEXT.md`; tests `chat`, `openrouter`, `presidio`, `privacy`, `helpers` (4 assertions pinned to the old behaviour updated to the new one, none removed or skipped).
New: `privacy/residual.ts`; tests `passthrough-mask.test.ts`, `residual.test.ts`, `entities.test.ts`. Deleted: none.
New flags: `--extra-entities` (all), `--residual-guard` (on), `--residual-checks` (all), `--residual-min-digits` (9). No new environment variable.

Run on the Linux copy (Node 22.22.0), `npm test` before the change: `tests 266 pass 266 fail 0`. After:

```
# tests 292
# suites 48
# pass 292
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Regression check: with `shapeBody` put back to copying the three fields raw, `node --test test/passthrough-mask.test.ts` gave `pass 10 fail 3` (the three leak tests); with the fix, `pass 13 fail 0`.
`node services/gateway/src/main.ts --help` lists the new flags; `--residual-guard maybe` is refused.

Not run: `npm test` on the Windows PC; the gateway against the real Presidio (the new ad-hoc patterns and the extended start-up sentence are checked only against the test Presidio and with JavaScript regex). No typecheck script exists in package.json (build.config.json names `npm run typecheck`).

Owner run on the Windows PC, 2026-10-24 00:14 IST, `npm test` in `chainaim-router-private-ai-2`:

```
tests 292  suites 48  pass 292  fail 0  cancelled 0  skipped 0  todo 0  duration_ms 5707.7452
```

Next: MANUAL_SETUP.md M1 step 2 (rebuild `ca-gateway`, start against the real Presidio).

Owner run, 2026-10-24 00:16–00:17 IST: `docker build -t chainaim-gateway:test -f services/gateway/Dockerfile .` from `chainaim-router-private-ai-2` (layer 7/7 `COPY services/gateway/src` rebuilt, not cached). `test-console\use-stand-in.cmd`: `Answer from stub/charlie-8b:free: echo: What is the capital of India?`. `docker logs ca-gateway`:

```
[chainaim-gateway] listening on http://:::8700  source=openrouter-free models=3 jev=on presidio=http://presidio.railway.internal:3000 extra-entities=bank_account,titled_name,street_address,dob,location residual=digits,spaced_digits,intl_phone,email,titled_name/9 ledger=/data/ledger auth=on
```

The real Presidio (`ca-presidio`) passed the extended start-up sentence: every extra group's value was detected with an expected type (otherwise the gateway refuses to start). M1 step 2 PASSED. Next: step 3 (sample bank statement, spy record).

New for step 3: `test-console/leak-check.ps1` (flags: -Document, -ValuesFile, -Question, -GatewayUrl, -KeyFile, -SpyContainer, -GatewayContainer, -LedgerLines, -SettleSeconds) and `test-console/samples/sample-bank-statement.values.txt` (the sample's 11 synthetic identifiers). The script posts the document to the gateway, reads what `ca-openrouter-stub` recorded (MODEL and JEV bodies) and the newest ledger lines, and fails if any listed value appears; it prints line numbers, never values.

Owner run, 2026-10-24 00:19 IST, real Presidio, stand-in model:

```
HTTP 200 from the gateway
left the gateway: 1 model body(ies), 1 Jev body(ies); ledger lines read: 3
PASS: none of the 11 values left; the model got masked text only
```

M1 PASSED (steps 1 to 3).

## 2026-10-24 — M1b: answer with placeholders kept (owner request)

Gateway: new request option `chainaim_restore` (boolean, default true; anything else 400). `false` returns the model's answer with the placeholders left in; the option never reaches the model (not in PASSTHROUGH); ledger records `restored: false`; response header `x-chainaim-restored: yes|no` (the paywall already passes `x-chainaim-*` back). Files: `services/gateway/src/chat.ts`, `server.ts`, `test/passthrough-mask.test.ts` (+3 tests).
Console: `test-console/console/index.html`, private chat tab: checkbox "Show the answer with placeholders"; when on, the request carries `chainaim_restore: false`, the answer is shown with highlighted placeholders, and it starts unticked in the history (sent back, its numbering could collide).

Run on the Linux copy: `npm test` `pass 295 fail 0`. UI driven in Chromium against a local gateway, test Presidio, spy and console: switch off → "Answer · placeholders restored" with real values; switch on → "Answer · placeholders kept" reading `<PERSON_1> ... <PERSON_2> ... <EMAIL_ADDRESS_1> ... <BANK_ACCOUNT_1>`; "Sent to the model" showed placeholders only in both. Not yet run on the Windows PC.

Owner run on the Windows PC, 2026-10-24 00:41 IST: `npm test` `tests 295 suites 49 pass 295 fail 0`; `docker build -t chainaim-gateway:test ...` (layer 7/7 rebuilt); `use-stand-in.cmd`: `Answer from stub/charlie-8b:free: echo: What is the capital of India?`. Next: the switch in the browser with an uploaded PDF.

Owner decision, 00:43 IST: no switch on the page; answers always keep the placeholders. `index.html`: checkbox removed; `const KEEP_PLACEHOLDERS = true` near the top of the script sends `chainaim_restore: false` on every private-chat Send (set it to false to restore real values). Re-run in Chromium on the Linux copy: "Answer · placeholders kept" with `<PERSON_1> <PERSON_2> <EMAIL_ADDRESS_1> <BANK_ACCOUNT_1>`; no `keepMasked` left in the page; PC copy 76,247 bytes, same as the tested copy.

## 2026-10-24 — M1c: place names no longer masked by default

Found on the PC, 00:56 IST: after `switch-models.ps1 -To ollama-cpu-8gb`, the test question "What is the capital of India?" reached `local/qwen2.5-3b` as "<LOCATION_1>" and the model could not answer (it also wrote `LOCATION_1` without brackets, so nothing was restored). Cause: M1 turned on the `location` group by default.
Change (owner approved 00:58): `entities.ts` `DEFAULT_EXTRA_GROUPS` = bank_account, titled_name, street_address, dob; `--extra-entities` default `default` (`all` adds location); `main.ts` help text. Tests: `privacy.test.ts` (default list without LOCATION; new test that LOCATION is off by default and on with all), `presidio.test.ts` (start-up message without LOCATION). Street addresses remain masked (STREET_ADDRESS).
Linux copy: `npm test` `pass 296 fail 0`; `--help` shows `(default = bank_account,titled_name,street_address,dob)`.

Owner run on the Windows PC, 2026-10-24 01:00 IST: `npm test` `tests 296 suites 49 pass 296 fail 0`; gateway image rebuilt; `switch-models.ps1 -To ollama-cpu-8gb` (registry config/local-models.cpu.json, the models this PC already had): `Answer from local/qwen2.5-3b: The capital of India is New Delhi.` M1c PASSED; local CPU models back on.

Owner check in the browser, 01:05 IST: console running from `chainaim-router-private-ai-2` (start.cmd, PID 26680), 02 Private chat, model local/qwen2.5-3b, attached `test-console/samples/sample-bank-statement.pdf`, question "Who is the account holder and who was paid?". Answer kept the placeholders: "The account holder is <PERSON_1> ... <PERSON_2> provided the monthly salary ..."; no real name, e-mail, phone, PAN, IBAN or card number in it; "Acme Logistics" in plain text (a company, not detected as personal data, as expected). Answer quality is the 3B CPU model's, not the masking's.

## 2026-10-24 — M1d: real statement values replaced with synthetic ones (privacy)

Found: one NZ bank account number and two titled names from the owner's own bank statement were used as examples and test values, and are in tag v1.0.2. Replaced in the same shapes so every rule and test keeps its meaning: account → `12-3456-7890123-00` (NZ 2-4-7-2 format, 15 digits: the standalone `nz account` pattern and the residual `digits` check both still fire); names → `MR AB SAMPLEPERSON`, `MRS C SAMPLENAME` (title + initials + surname; mixed-case comment forms likewise).
Files (7): `services/gateway/src/privacy/entities.ts` (comments 138, 151; `EXTRA_CANARY` bank_account and titled_name 197-198), `services/gateway/src/privacy/residual.ts` (comments 38, 45), `scripts/synthetic-corpus.ts` (`KNOWN_VALUES` 33-34), `services/gateway/test/entities.test.ts` (23, 30), `services/gateway/test/residual.test.ts` (11, 16), `services/gateway/test/passthrough-mask.test.ts` (141), and `DESIGN/xrplh-5-PRIVATE-AI-2-STRUCTURE-and-MASKING-FIX-2026-10-23T2322.md` (19, 21; tracked, not in the handoff list).
Check: case-insensitive search of the whole working tree (node_modules and .git excluded) for the three real values: 0 matches.
Run in the Linux shell on the PC (Node v22.23.4), 03:3x IST: `npm test` `tests 296 suites 49 pass 296 fail 0`. `npm run typecheck`: "Missing script" (none exists). No snapshot: `.claude/hooks/snapshot.js` does not exist. Not yet run: Windows `npm test`, gateway image rebuild, start-up canary against the real Presidio with the new values.
Rule note: the agent ran one read-only `git ls-files` to see whether DESIGN/ is tracked; no other git command.

Owner run on the Windows PC, 2026-10-24 03:34 IST: `npm test` `tests 296 suites 49 pass 296 fail 0 cancelled 0 skipped 0` (M1d step 1 PASSED). Next: gateway rebuild and start-up canary with the synthetic values.
Owner run, 2026-10-24 03:37 IST (after starting Docker Desktop, which was stopped): `docker build -t chainaim-gateway:test -f services/gateway/Dockerfile .` FINISHED 12/12, layer `[7/7] COPY services/gateway/src` rebuilt, image `chainaim-gateway:test` (M1d step 2a PASSED). Next: `switch-models.ps1 -To ollama-cpu-8gb` to recreate ca-gateway and run the start-up canary.
Owner run, 2026-10-24 03:4x IST: `switch-models.ps1 -To ollama-cpu-8gb`. Two environment fixes first, no code change: (a) `test-console/local-gateway-key.txt` was missing in this repo; copied from `PRIVAI1\chainaim-router\test-console\` (the only copy on the PC; gitignored); (b) Ollama lacked `qwen2.5:1.5b-instruct` (in `config/local-models.cpu.json`); `ollama pull qwen2.5:1.5b-instruct` (986 MB). Also `ca-presidio`, `ca-openrouter-stub`, `ca-paywall` had exited (255) when Docker stopped; `docker start` brought them up. Then the gateway answered `/healthz` and the script reached "Test question". Since `main.ts` awaits `waitForPresidio` (line 180, start-up test sentence) before `server.listen` (line 229), the start-up test with the synthetic bank account and titled name PASSED against the real Presidio (M1d step 2b).
Owner run, 2026-10-24 03:44 IST: test question answered: `Answer from local/qwen2.5-3b: The capital of India is New Delhi.` then "Local CPU models are on". M1d steps 1-2 PASSED on the Windows PC. Next: owner commit, tag v1.0.3, push to private2.

## 2026-10-24 — S1: test-console/stack.ps1 (one script owns the local containers)

Found in the UI (03:5x IST): the console's paid chat showed "Send ($10000)". `docker inspect ca-paywall` (owner run): image `chainaim-paywall:test` created 2026-10-17T17:25:53Z, env names `CHAINAIM_GATEWAY_KEY AVM_PAY_TO X402_NETWORK GATEWAY_URL ...`, no `XRPL_*`: the Algorand-era paywall (10000 = 0.01 in 6-decimal micro-units; this repo's tests expect `amount: "0.01"`, and `services/web/test/xrpl-payment.test.ts:119` refuses 10000). Cause: containers built by hand at different times from different repo copies; nothing checked them.
New: `test-console/stack.ps1` (268 lines, ASCII). `-Rebuild paywall|presidio|stub|gateway|all` builds from this repo with labels `chainaim.source`/`chainaim.built`; `-Recreate paywall|presidio|stub|all`; `-Check` (default) verifies per container: running, on the network, runs the current build of its tag, image source = this repo, bind mounts inside this repo, paywall has XRPL settings and no AVM_PAY_TO/X402_NETWORK, paywall and gateway key match the key file (compared, never printed), and the paywall's live unpaid-chat quote = `-ExpectPrice` (0.01) on the expected CAIP-2 to the expected pay-to. Run settings copied from docs/setup-end-to-end.md §6. ca-gateway stays with switch-models.ps1.
Verified: PowerShell 7.4.6 parser: PARSE OK (byte-identical copy, md5 c76f9ac2...); guard paths run: `-Check -Rebuild paywall` refused, no Docker -> "Docker is not answering", `-Rebuild bogus` refused by ValidateSet. Not verified: any Docker path (needs the PC) and Windows PowerShell 5.1.
Doc: RUN-ON-ANOTHER-PC.md step 6, the Algorand paywall `docker run` replaced by `stack.ps1 -Recreate paywall` and `stack.ps1 -Check`.
Owner run, 2026-10-24 04:06 IST: `stack.ps1 -Check` ran on Windows PowerShell: 8 problems. ca-paywall: AVM_PAY_TO, X402_NETWORK, no XRPL_NETWORK, quote amount 10000 on `algorand:SGO1...` to an Algorand address (Algorand image 2026-10-17). ca-openrouter-stub: /app/scripts and /spy mounted from PRIVAI1\chainaim-router (second drift, not seen before). Keys of ca-paywall and ca-gateway match the key file; ca-gateway mounts /config from this repo. WARN image source unknown on the 3 hand-built images (expected).
Owner run, 2026-10-24 ~04:15 IST: `stack.ps1 -Rebuild paywall -Recreate stub` (check output not pasted). Console after restart: "Pay with Crossmark ... On: each Send pays 0.01 RLUSD on testnet to rn5hSy7QvsrQLpGb3k5dp4h8Yrk9J7gBej", button "Send ($0.01)". The paywall quote is fixed. Next: one paid Send with Crossmark.

## 2026-10-24 — P1: paying without Crossmark (private-ask.ts, seed signer)

Found: no `.env` in PRIVAI2 or PRIVAI1; no `XRPL_SEED_*` name in any `.env` under FINAGENTS (owner listing, names only). Tenant seeds are in the owner's password manager (STATE.md 2026-10-23); they are loaded at a hidden prompt for one window, never written to a file.
Owner run, 2026-10-24 04:31 IST: `npm --prefix services/paywall install` (added 96 packages). `node scripts\private-ask.ts --file ..\..\rig\tenants\t01\docs\supplier-dispute.txt --dry-run`: 711 characters; masked on this computer 2 PERSON, 1 EMAIL_ADDRESS, 1 IN_BANK_ACCOUNT; request body holds only <C_*> placeholders; "dry run: nothing was sent and nothing was paid". Next: paid run as t01.
2026-10-24 ~04:45 IST: no old tenant seed at hand, so a new TestNet buyer wallet B01 was made offline with `node scripts\new-account.ts`: address `racuvQQJSCD2YUxR5qLstLBfbCkxj53dcU` (checksum valid). Seed kept by the owner in `C:\PRIV-AI-SECRETS\testnet.env` as `XRPL_SEED_B01_TESTNET` (outside every repo and sync folder, TestNet only; never read by the agent). Not on the ledger until funded.
2026-10-24 ~04:58 IST: faucet API funded B01 (account block returned, classicAddress racuv...).
2026-10-24 ~05:00 IST: B01 funded with 100 XRP (faucet API); `trust-line.ts` opened its RLUSD trust line: tx A689DDB3B0986AD8612EF4876511CEB9466409F34D5DDD888A265C3375DC48F2. Seed loaded from C:\PRIV-AI-SECRETS\testnet.env for that one command, then removed. Next: TestNet RLUSD into B01.
2026-10-24 ~05:27 IST: new Crossmark wallet C01 (funding-only, for the RLUSD faucet; this Chrome profile's first Crossmark setup): address rpViNCWEsanJ2Yyu8qzPNA5Ux5Vy1j3ETG (checksum valid). B01's seed stays only in C:\PRIV-AI-SECRETS\testnet.env.
2026-10-24 ~05:43 IST: C01 funded (faucet API). tryrlusd.com XRPL tab: Connect + Fund done with Crossmark (C01); 'Add RLUSD Trustline' fails in Crossmark with 'Connection Instability' (Wi-Fi; also with Crossmark switched to a Ripple node). PowerShell account_lines for C01 from the PC: status success, no lines, so the PC reaches TestNet and the TrustSet never reached the ledger. Crossmark extension cannot submit; cause not found yet.

## 2026-10-24 — P2: buy-rlusd.ts (TestNet RLUSD for a buyer without a browser wallet)

Why: Crossmark (this Chrome profile) cannot submit to any TestNet node ("Connection Instability"), while the PC, PowerShell and Chrome itself reach TestNet (explorer loads C01; account_lines success). Owner has no old .env. Liquidity check (owner run): `book_offers` RLUSD-for-XRP: 2 offers; `amm_info` XRP/RLUSD: exists, 119788.71 RLUSD in pool.
New: `services/paywall/scripts/buy-rlusd-core.ts` (parseBuyArgs, bestXrpQuote, sendMaxDrops, buyPayment, buyOutcome), `scripts/buy-rlusd.ts` (CLI: --amount 1, --max-xrp required, --slippage-pct 2, --seed-prefix, --env-file, --dry-run), `test/buy-rlusd.test.ts` (11 tests). The buy is a self-Payment: Amount = exact RLUSD, SendMax = quote + slippage, capped by --max-xrp; no partial-payment flag, so all-or-nothing. Price from the server's ripple_path_find just before signing. TestNet forced, as in trust-line.ts.
Run in the Linux shell on the PC: `node --test test/buy-rlusd.test.ts` tests 11 pass 11 fail 0. `node scripts/buy-rlusd.ts` with no --max-xrp: `--max-xrp "" is not a positive amount of XRP`, exit 2. Full `npm test` in services/paywall did not finish within the shell's 170 s limit: not verified here; owner to run on Windows.
Owner run on Windows, 2026-10-24 ~06:00 IST: services/paywall `npm test` tests 101 suites 23 pass 101 fail 0 (incl. 11 buy-rlusd). Dry run as B01: RLUSD balance before 0; 'the ledger quotes 12.15137 XRP, above --max-xrp 5' (cap refused before signing, as designed).
Owner run, 2026-10-24 ~06:02 IST: buy-rlusd.ts as B01, --amount 1 --max-xrp 13: dry run quote 12.15137 XRP, SendMax 12.394397, 1 path; real run 'bought 1 RLUSD; transaction 8A5A86B2B54213543DEEB7AC891192BD18DD191BA305913F7CEA52423321E626', RLUSD balance after: 1. P2 PASSED. Next: paid private-ask as B01.
P3 (owner request): `services/paywall/scripts/balances.ts` + `balances-core.ts` + `test/balances.test.ts`: read-only XRP and RLUSD balances for `--account label=rADDRESS` (repeatable), no seed. Linux shell: tests 4 pass 4 fail 0. Seller (paywall pay-to) = rn5hSy7QvsrQLpGb3k5dp4h8Yrk9J7gBej (stack.ps1 quote check).
balances.ts: --title flag added (heading such as BEFORE / AFTER).
Owner run, 2026-10-24 00:39:03Z: BEFORE balances: buyer B01 racuv... XRP 87.848606 RLUSD 1; seller rn5h... XRP 99.999988 RLUSD 0.35.
Owner run, 2026-10-24 ~00:40Z: paid private-ask as B01, no Crossmark (seed from C:\PRIV-AI-SECRETS\testnet.env for one command): masked on this computer 2 PERSON, 1 EMAIL_ADDRESS, 1 IN_BANK_ACCOUNT; 926 bytes to /v1/chat/completions; HTTP 200; x-chainaim-model local/qwen2.5-3b, data-class PII, attempts 1, restored yes; payment success true, transaction 2FCF14E90D477714A2FC77B890A459EF86E580A99AF88B95A173EDAB9ABE180B, network xrpl:1, payer B01, t54 attestation (rewards-testnet, nonProduction). P1 PASSED: a paid x402 private chat without a browser wallet.
Found: the model wrote placeholders without brackets ("Person_1", "C_EMAIL_ADDRESS_1"), so client restore left them (no leak; missed restore; same model habit as M1c). Answer cut at 512 tokens (private-ask default --max-tokens 512). Open: restore that tolerates bracket-less placeholders (needs owner go-ahead).
Owner run, 2026-10-24 00:41:05Z: AFTER balances: buyer XRP 87.848596 RLUSD 0.99 (-0.01 RLUSD, -0.00001 XRP fee); seller XRP 99.999988 RLUSD 0.36 (+0.01 RLUSD). Matches tx 2FCF14E9...180B. P1 PASSED.

## 2026-10-24 — R1 diagnosis: placeholders the model rewrote were not restored

Reproduced with the real client restore (services/paywall/scripts/client-mask.ts `restore`, synthetic map): "Person_1", "Person_2 (Person_2,", "C_EMAIL_ADDRESS_1", "(C_IN_BANK_ACCOUNT_1)" all come back unchanged with unresolved 0; control "<C_PERSON_1> and < c_person_2 >" restores. Cause: both restores match only `<...>` (client CLIENT_PLACEHOLDER `/<\s*(C_[A-Za-z][A-Za-z_]*?_\d+)\s*>/gi`; gateway restore.ts PLACEHOLDER `/<\s*([A-Za-z][A-Za-z_]*?_\d+)\s*>/g`). The model (local/qwen2.5-3b) dropped the angle brackets, wrapped some in parentheses, and for names also dropped the C_ prefix and changed case. Nothing tells the model to copy placeholders exactly (no such instruction in gateway, scripts or console). The miss is silent: unresolved counts only bracketed placeholders missing from the map, so it reads 0, and private-ask prints nothing; x-chainaim-restored: yes only says restore was requested. No leak: only placeholders left the computer. Fix not started (owner go-ahead).

## 2026-10-24 — R1 fix: lenient restore, honest counts, copy-placeholders instruction; E2E script

Test-first (tests written and seen failing before the code):
- Gateway `src/privacy/restore.ts`: `restoreText(text, map, stats, json, { lenient })`, lenient by default. Bracketed <TYPE_N> as before; for names in this request's map only, also bare tokens (whole-token: PERSON_1 never inside PERSON_10 / C_PERSON_1 / XPERSON_1), [..] and {..} (dropped), any case; parentheses and quotes kept as prose. A bare lookalike of a map type not in the map (PERSON_9) is counted as unresolved. `stats.lenient` counts lenient restores. New `hasPlaceholder`, `PLACEHOLDER_INSTRUCTION`.
- Gateway `src/chat.ts`: options `restoreLenient` and `placeholderInstruction` (both default true); when the masked request (messages or tools/response_format/stop) holds a placeholder, the instruction is the model's first system message, added after classification (Jev never sees it). Ledger: `lenientRestores`, `placeholderInstruction`. `src/server.ts`: header `x-chainaim-unresolved: N`. `src/main.ts`: flags `--restore-lenient on|off`, `--placeholder-instruction on|off` (default on), shown in the start-up line.
- Client `services/paywall/scripts/client-mask.ts` `restore(text, map, { lenient, dropPrefix })`: same rules for <C_...>; with dropPrefix (default) a bare name without C_ ("Person_1") maps to <C_PERSON_1>; the server's bracketed <PERSON_1> is still left alone and not counted. `private-ask.ts` prints a WARNING when anything was not put back.
- New `services/paywall/scripts/e2e-private-ask.ts` + `e2e-core.ts`: BEFORE balances (seller from the paywall's own quote), WORK (mask here, pay over x402 with the seed, restore here), AFTER (waits until the validated ledger shows the payment, --settle-wait-sec 30), VERDICT (8 checks: quote network, no original value in the request body, HTTP 200 with an answer, payment settled, payer is the buyer, buyer -price, seller +price, every placeholder put back); exit 0 only if all pass. `balances-core.ts` gains `readAccountState` (shared by balances.ts and the E2E).
- Tests: gateway `test/restore-lenient.test.ts` (13), `test/placeholder-instruction.test.ts` (6, real sockets); paywall `test/restore-lenient.test.ts` (11, the real run's strings), `test/e2e.test.ts` (9). `test/chat.test.ts`: two tests read the assistant turn at messages[1]; the instruction now comes first, so they find the assistant turn by role (same assertions). `test/helpers.ts`: `chatExtra` option.
Runs in the Linux shell: gateway restore-lenient + placeholder-instruction: tests 19 pass 19; paywall restore-lenient + client-mask: tests 20 pass 20; paywall e2e + balances: tests 13 pass 13; e2e CLI refusals (no --file; --settle-wait-sec 999): exit 2. Full suites: see the next entries.
2026-10-24 01:2xZ review (same chat; the R1 fix above was made by an earlier, interrupted run of this chat): gateway full npm test 315/315 (Linux shell); paywall restore-lenient + e2e + client-mask + balances + buy-rlusd: 44/44; chat.test.ts lines 93/118 find the assistant turn by role instead of messages[1] (instruction now first); assertions after it unchanged. Full paywall suite: owner on Windows.
Owner run on Windows, 2026-10-24 01:24Z: services/paywall npm test tests 125 suites 30 pass 125 fail 0 (incl. client lenient restore, e2e, balances, buy-rlusd). Gateway 315/315 (Linux shell, 01:18Z). Next: rebuild gateway image, switch models, run e2e-private-ask.ts.
Owner run, 2026-10-24 01:27Z: stack.ps1 -Rebuild gateway (image labelled from this repo; expected FAIL 'older build' for ca-gateway; paywall, stub all OK incl. quote 0.01 xrpl:1 to rn5h...); switch-models.ps1 -To ollama-cpu-8gb recreated ca-gateway on the new image: 'The capital of India is New Delhi.' Next: e2e-private-ask.ts as B01.
Owner run, 2026-10-24 01:28Z: `e2e-private-ask.ts --file ..\..\rig\tenants\t01\docs\supplier-dispute.txt --env-file C:/PRIV-AI-SECRETS/testnet.env --seed-prefix XRPL_SEED_B01`: BEFORE buyer 0.99 / seller 0.36 RLUSD; WORK masked 2 PERSON, 1 EMAIL_ADDRESS, 1 IN_BANK_ACCOUNT, 927 bytes, HTTP 200 after 11.8 s, local/qwen2.5-3b, x-chainaim-unresolved 0, payment success tx 8F76668FC5D2673ABD96EF4864C5268A9E92484089FDE0D5FA880EB0BBF5CEE5; AFTER buyer 0.98 / seller 0.37, fee 0.00001 XRP; VERDICT 8/8 PASS, "END-TO-END PASSED". Note: the answer used no placeholders, so lenient restore was not exercised live (covered by the 11 tests from the earlier run's strings). Answer has a model arithmetic error (9,850/2), not a pipeline issue.

## 2026-10-24 — R1b: gateway no longer counts the client's <C_...> placeholders

Owner E2E run 01:32Z (question forcing names): client restored all (Ms. Priya Vasquez, account 004512378901; "this computer 0"), but `x-chainaim-unresolved: 3` and VERDICT FAIL "gateway 3". Cause (read in restore.ts): the gateway restores before the client, and its BRACKETED pattern also matched <C_PERSON_2> (twice) and <C_IN_BANK_ACCOUNT_1>, not in its map, so counted unresolved. Fix: restore.ts leaves bracketed <C_...> untouched and uncounted (the client restores it). Test-first: 2 new tests in test/restore-lenient.test.ts failed (fail 2), then passed. One existing R1 test expected the bug (counted <C_PERSON_1> at the gateway: unresolved 2); its expectation corrected to 1 (it still checks that unknown <PERSON_9> is counted). Gateway `npm test` (Linux shell): tests 317 pass 317 fail 0. Needs the gateway image rebuilt. Also seen in that answer: "My name is INV-5518" (model put the invoice where <C_PERSON_1> belonged): model quality, not restore.
Owner run, 2026-10-24 01:37Z: gateway image rebuilt with R1b (layer 7/7), ca-gateway recreated (switch-models ollama-cpu-8gb): 'The capital of India is New Delhi.'

## 2026-10-24 — R2: residual check read "Dr. <placeholder>" + next line as a titled name

Owner E2E run 01:38Z (t02 discharge note): HTTP 422 "titled_name 1"; nothing sent, not charged (balances unchanged). Client masked output has no hit line by line; on the whole text residualHits gives titled_name 1; minimal repro "Attending: Dr. <C_PERSON_2>\n\nDiagnosis: type 2" -> titled_name 1. Cause: residual.ts replaced placeholders with " ", so "Dr.   \n\nDiagnosis" matched title + \s+ + capital. Fix: placeholders become " # " (neutral, non-letter; still splits digit runs). Test-first: test/residual.test.ts +2 tests (false-positive cases failed first; unmasked "Dr. Okafor" and "MR\nSAMPLEPERSON" still detected). Gateway npm test (Linux shell): tests 319 pass 319 fail 0. Needs gateway rebuild. No leak at any point (fail closed).
Owner run, 2026-10-24 01:43Z (gateway rebuilt with R1b + R2): E2E t02 discharge note, question naming patient and doctor: masked here 2 PERSON, 1 MEDICAL_RECORD, 1 IN_AADHAAR; HTTP 200 after 8.4 s; data-class PHI; local/qwen2.5-3b; unresolved 0; tx E8DC51C0D93D36F760F78E0C8D45F968B3F95834F1A5A55C592BCF7811ABD4F4; answer shows Meera Thalavan and Dr. Samuel Okafor restored on this computer; buyer 0.97 -> 0.96, seller 0.38 -> 0.39, fee 0.00001 XRP; VERDICT 8/8, END-TO-END PASSED.
2026-10-24 02:02Z: wrote DESIGN/xrplh-6-ASK-PAYMENT-ATOMICITY-2026-10-23T2102.md (ask/payment coupling, W1/W2 gaps, proposed fix); breadcrumb in STATE.md.

## 2026-10-24 — H1: no wallet addresses written into code or tests (owner request)

Found (grep of .ts/.ps1/.json/.cmd): B01 and seller addresses as constants in services/paywall/test/{balances,buy-rlusd,e2e}.test.ts, and the seller as stack.ps1's $TestnetPayTo default.
- Tests: addresses now `Wallet.generate().classicAddress` per run; the bad-checksum case always changes the last character. `node --test` balances + buy-rlusd + e2e: tests 24 pass 24 fail 0 (Linux shell).
- stack.ps1: $TestnetPayTo removed. Pay-to order: -PayTo, else XRPL_PAY_TO_<NET> in the window, else the running ca-paywall's own XRPL_PAY_TO_<NET> (read before the container is replaced), else stop. PowerShell 7.4.6 parser: PARSE OK (md5 ee82e180...); no non-ASCII.
- balances.ts: new --buyer-seed-prefix + --env-file (buyer derived from its seed, never printed) and --seller-from-paywall URL (seller from the live quote via e2e-core decodeQuote); --account kept. CLI refusals: no account -> exit 2; non-http paywall -> exit 2; missing seed variable -> exit 2.
Remaining fixed values: none in code/tests; addresses appear only in logs (BUILD_LOG/STATE) as records.
Owner run on Windows, 2026-10-24 02:21Z: services/paywall npm test 125/125 (generated test addresses); balances.ts --buyer-seed-prefix XRPL_SEED_B01 --env-file ... --seller-from-paywall http://127.0.0.1:8080: buyer racuv... 87.848566 XRP / 0.96 RLUSD, seller rn5h... 99.999988 XRP / 0.39 RLUSD (no address typed).

## 2026-10-24 — E2E-2: ledger lookup of the payment, fee check, truthful step order

- Owner asked whether masking and the model call happen between BEFORE and AFTER. Read the script: the model call did (inside sendAsk), but client masking ran before BEFORE and the unpaid quote call sent the masked body. Now: quote from an unpaid call with a neutral body ("price?"; paywall answers 402, forwards nothing); BEFORE; WORK masks (prepareAsk) then pays and asks; AFTER; the document is still read first so a bad file is refused before any network call.
- New checks (e2e-core.ts): `ledgerTxFrom` (tx answer, api_version 1 and 2 shapes); verdict "payment on the ledger" (validated, tesSUCCESS, from the buyer, to the quoted pay-to, delivered exactly the quoted RLUSD amount/currency/issuer) and "buyer's XRP change is the fee". Script looks the receipt's hash up with `tx`, waiting for validation within --settle-wait-sec. Verdict now 10 checks.
- Test-first: test/e2e.test.ts +7 tests (ledgerTxFrom 3, ledger/fee verdict 4) seen failing first (no export). Two existing fixtures now keep `...GOOD.after` (they vary only RLUSD; assertions unchanged).
Linux shell: e2e + balances + buy-rlusd + restore-lenient + client-mask: tests 51 pass 51 fail 0. E2E CLI refusals (no --file; no seed): exit 2. Full paywall suite and a live run: owner on Windows.
E2E-2b: e2e-private-ask.ts --show-sent (default on; --no-show-sent) prints the masked question+document that leave the computer (placeholders only), inside WORK after masking.
Owner run, 2026-10-24 02:34Z: E2E t03 shipment-kyc (with --show-sent): masked here 2 PERSON, 1 EMAIL_ADDRESS, 1 IN_PAN, 1 IN_AADHAAR, 1 IN_IFSC; sent text holds only placeholders; HTTP 200 after 18.2 s, local/qwen2.5-3b, PII, unresolved 0; tx 8C780E36B990BB6B4215667A64B9E911C3DE2570B4D47A944F943055FDC779F7; ledger: validated, tesSUCCESS, B01 -> seller, delivered 0.01 RLUSD, fee 10 drops; answer "Dear Tomas Ridgeway" restored here; buyer 0.96 -> 0.95, seller 0.39 -> 0.40; VERDICT 10/10, END-TO-END PASSED.
Found (no leak): client-mask typed the 12-digit bank account after "a/c" as IN_AADHAAR (wrong label), and masked "Ridgeway" inside "Ridgeway Marine Supplies" as a second PERSON (over-masking). Cause not yet read in client-mask.ts.
2026-10-24 03:09Z: DESIGN/README.md (new team member: create buyer wallet, XRP, trust line, buy RLUSD, testnet2.env, stack, E2E command, troubleshooting), from commands run on 2026-10-24.
DESIGN/README.md: added 'Quick start: every PowerShell command, in order' (blocks A-K with $REPO/$PREFIX/$ENVF/$SELLER variables). No seed-like strings.

## 2026-10-24 — S2: test-console/buyer.ps1 (one command per wallet step and the E2E run)

Owner request: runnable PowerShell, the seed file a parameter (not hard-coded). `buyer.ps1 -Step create|address|fund|trustline|buy|balances|e2e|setup -Prefix <PREFIX> -EnvFile <file>`; -Prefix and -EnvFile mandatory, no defaults. create: refuses an existing PREFIX_TESTNET in the file; runs new-account.ts, appends "# address r..." and PREFIX_TESTNET=seed with UTF-8 no BOM; prints the address only. Refuses an -EnvFile inside the repository, and runs only after services/paywall npm install. trustline sets XRPL_BUYER_SEED_TESTNET for one call and removes it (finally). buy quotes, asks y/N (-Yes skips), then buys. e2e clears a leftover PREFIX_TESTNET variable first.
Verified (PowerShell 7.4.6, byte-identical copy md5 e50e7421...): PARSE OK; lowercase -Prefix refused (case-sensitive check added after the first test accepted "bad"); missing -EnvFile refused; -EnvFile inside the repo refused; unknown -Step refused; no node_modules refused. Not verified: any network step (owner on Windows). ASCII only. DESIGN/README.md: "Fastest: run the script" section added above the quick start.
DESIGN/README.md: added 'Examples that ran in the 2026-10-24 session' (t03 KYC, t02 PHI, t01 explain, t01 refund letter, direct e2e, private-ask only, own document) with results and tx hashes from BUILD_LOG.
buyer.ps1: -File resolved to a full path before node runs from services\paywall (relative paths like .\rig\... in the README examples).

## 2026-10-24 — L1 on Bedrock: Strands agent on Nemotron 3 Nano (Sydney), first paid run; residual false refusal fixed

AWS (owner runs, 11:44–12:12 IST):
- The AWS free-plan project "Hold My Coffee" (account 897258608518) is limited to ap-southeast-2 (Sydney); the console refused us-east-1 ("upgrade your plan"). No upgrade made.
- Model catalog (Serverless): Nemotron Nano 3 30B, model id `nvidia.nemotron-nano-3-30b`, categories include "Tool use and function calling", deployment Serverless. Playground in Sydney: answered (input 17, output 13 tokens, 267 ms). No Anthropic use-case form needed (NVIDIA model).
- CLI: `aws login --profile chainaim --remote` (the default browser was signed in to another account, 721082558411 root; its overwrite prompt was answered n). `aws sts get-caller-identity --profile chainaim`: Account 897258608518, assumed role AccountFullAccessRole.
- `aws bedrock-runtime converse --model-id nvidia.nemotron-nano-3-30b --region ap-southeast-2`: answered, 254 ms. With a tool config shaped like `chainaim_private_ask(file, question)`: `stopReason tool_use`, toolUse name chainaim_private_ask, input {file: doc-1.txt, question}, 423 ms, 359/51 tokens; the reply also held a text block with only a line break (harmless to Strands, seen below).

Agent (owner runs, `services/paywall`, Wi-Fi):
- `npm install` (96 packages; 7 audit advisories, not addressed) and `npm test`: 90/90.
- Dry run `--tenant t02 --dry-run --region ap-southeast-2 --model-id nvidia.nemotron-nano-3-30b`: the agent called the tool; the discharge note was masked on the PC (patient, MRN, Aadhaar, doctor); nothing sent or paid.
- Paid run 12:24 IST: `HTTP 422 from the paywall`, nothing charged (spent 0). Gateway ledger line: `"residual":[{"kind":"titled_name","count":1}],"status":422,"attempts":[]`. Cause (read in `privacy/residual.ts`): placeholders are replaced by a space before the check, and the titled-name pattern allowed `\s+` (line breaks included) after the title, so `Attending: Dr. <C_PERSON_2>` + newline + `Diagnosis:` read as a titled name. The agent's model (Nemotron) also invented a reason ("insufficient funds"): the tool had told it only "HTTP 422".

Fixes (owner approved "go" 12:29):
- `services/gateway/src/privacy/residual.ts`: titled_name allows only spaces or tabs between title and name; `test/residual.test.ts` +1 test (the masked discharge note passes; `Dr. Grant`, `Dr. <C_PERSON_1> Grant`, `Dr.\tGrant` still refused).
- `services/paywall/scripts/private-ask-core.ts`: `refusalReason(raw)` reads the gateway's `{error:{message}}`, at most 400 characters, dropped if this machine's masker finds a personal value in it. `scripts/agent-core.ts`: a failed call tells the model ChainAim's reason and "nothing was charged"; an unsettled price is no longer shown as paid. `test/agent.test.ts` +1 test.
- Owner runs: gateway `npm test` 297/297; paywall `npm test` 91/91; `docker build -t chainaim-gateway:test ...` (layer 7/7 rebuilt); `switch-models.ps1 -To ollama-cpu-8gb` answered from local/qwen2.5-3b.

Paid run 12:41 IST, PASSED: `[chainaim_private_ask] discharge-note.txt: answered, 0.01 RLUSD, tx 1381D3AC072E7BAF2CE8F845F735D361CC523CA693939C5D0425D827130E8660`; ChainAim's answer from local/qwen2.5-3b (the only models in the loaded catalog `config/generated/catalog.local.json`), then Nemotron's reply summarising it; `session: 1 tool call(s), spent 0.01 RLUSD`. Paid from tenant t02's seed wallet `rD59tmENJNnHovdi4hKq79DVP4gnDNFGWk` (not Crossmark). Not timed.

## 2026-10-24 — L1 privacy: prompt masking, document aliases, tenant label, Sydney/Nemotron defaults (code done; owner test run pending)

- `scripts/agent-core.ts`: `AskSession.maskPrompt(prompt)` (masks with `client-mask.ts`, self-check, keeps the map for `restoreForDisplay`; refuses with exit code 1 when a value would be masked again); `AskSession.documentNames()` (doc-1.txt, doc-2.md ... in name order when `docAliases` is on; the tool then accepts only aliases, refusing real names); the screen shows `doc-1.txt (discharge.txt)`. New `SessionOptions` `promptMask`, `docAliases`, both off when unset, so existing callers behave as before.
- `scripts/agent.ts`: defaults `--region ap-southeast-2`, `--model-id nvidia.nemotron-nano-3-30b`; new flags `--prompt-mask on|off` (on), `--doc-aliases on|off` (on), `--tenant-label` ("the user's organisation"; the tenant's real name is no longer sent to Bedrock unless passed here); prints what is sent to Bedrock, and the masked prompt under `--show-masked`.
- `test/agent.test.ts` +2 tests (prompt values never reach the scripted model and are restored on screen; aliases only in the instructions, real names refused).
- Limitation: `client-mask.ts` masks names only after a label ("Name: ..."); a bare name in a typed sentence still reaches Bedrock.
- Not run yet: `npm test` in `services/paywall` (expected 93) and a Bedrock run with the new defaults.
- Owner runs 13:20–13:21 IST: `npm test` 93/93; live dry run with the new defaults: Bedrock was sent tenant "the user's organisation", documents `doc-1.txt`, prompt `Patient Name: <C_PERSON_1>` (typed name masked); the tool was called as `doc-1.txt (discharge-note.txt)`.

## 2026-10-24 — Nemotron on Bedrock as ChainAim's answering model too (rig R5, catalog, mode); alias note

- New: `services/paywall/scripts/rigs/bedrock-core.ts` + `bedrock.ts` (rig R5: converse, tool, openai checks; flags --region, --model-id (repeatable), --tool-check, --openai-check, --openai-base (repeatable), --provider-field-check, --api-key-env, --timeout-ms, --out; result lines hold outcomes, timings, tokens and statuses only, never model text or the key); `test/rig-bedrock.test.ts` (5 tests); `config/catalog.bedrock.json` (bedrock/nemotron-nano-3-30b, zone private-cloud, probe false, apiKeyEnv BEDROCK_API_KEY, then local Qwen 3B/1.5B; pricing 0 is a labelled placeholder); `config/scores.bedrock.json` (Nemotron quality 8 fast, Qwen 3B 7 medium); `test-console/modes/bedrock.json`. `services/paywall/package.json`: `@aws-sdk/client-bedrock-runtime` 3.1156.0 listed (already installed through Strands).
- Owner runs: `npm install` up to date; `npm test` 98/98. `node scripts/rigs/bedrock.ts`: converse 294 ms, tool 407 ms (toolCall=true). Bedrock API key: long-term, created in ap-southeast-2 at 13:39 IST, expires in 5 days (shortest choice of at least 3); kept in the owner's password manager, loaded into the PowerShell session at a hidden prompt; not in `.env` (checked: absent; `.env` is git-ignored). `--openai-check on`: 6/6 PASS — bedrock-runtime `/openai/v1` and bedrock-mantle `/v1` both HTTP 200 (about 2.0–2.2 s each), with and without the `provider` field. So no gateway code change (P10) is needed.
- `switch-models.ps1 -To bedrock`: "Answer from bedrock/nemotron-nano-3-30b: The capital of India is New Delhi" (the narrow-space character displays oddly in Windows PowerShell).
- First agent paid run (13:49): Nemotron did not call the tool and asked for the file name — the aliases hid the meaning the real name carried. Fix: `agent-core.ts` `ALIAS_NOTE`, added to the instructions only when aliases are on (single document: use it; several: ask the user to pick from the list); `agent.ts` passes `aliased`; `agent.test.ts` checks the note is present with aliases and absent without. Owner `npm test` after this fix (13:54 IST): 98/98.
- Agent paid run 13:52 IST, PASSED with Nemotron in both roles: `doc-1.txt (discharge-note.txt): answered, 0.01 RLUSD, tx 6044D2F4999730ECB08C4E8CBE3C8E06177A8234A825247CE15A5AD19A5F2306`. Gateway ledger: `promptChars 714`, `dataClass PHI`, `dataCollection deny`, chain [bedrock/nemotron-nano-3-30b, local/qwen2.5-3b, local/qwen2.5-1.5b], served bedrock/nemotron-nano-3-30b, attempt 2436 ms, gateway latencyMs 3200. Whole command: 19.7 s (over the 10 s target; the split between Node start-up, Bedrock turns and the XRPL payment is not measured yet).

## 2026-10-24 — F2: typed prompt masked with the tenant's own Presidio on the PC

- New `services/paywall/scripts/prompt-scan.ts`: `PromptScan` (scanner client|presidio|both; `detect`, `mask`, `ready`, `describe`) and `presidioClient` (reuses the gateway's `PresidioClient`, `detection()`/`parseExtraGroups`, `residualHits` by relative import; the gateway code is dependency-free TypeScript). Presidio spans of masked or card types only (health terms stay). Merge: longer span wins. Masking via `client-mask.ts` `mask` (`<C_TYPE_n>`, `[CARD REMOVED]`). Self-check with every detector in use, ignoring spans inside placeholders; residual check optional. Every Presidio failure → `AskRefused` (exit code 1) naming URL and failure only.
- `scripts/agent-core.ts`: `maskPrompt` async, uses `SessionOptions.promptScan` (unset: client patterns + residual check).
- `scripts/agent.ts`: flags `--prompt-scanner both`, `--presidio-url http://127.0.0.1:5002`, `--presidio-threshold 0.4`, `--presidio-timeout-ms 5000`, `--presidio-wait-ms 10000`, `--presidio-extra-entities default`, `--prompt-residual on`; start-up `ready()` check; on failure prints the reason and sets exit code 2 without `process.exit()` (Windows crash after a network call); start-up line names the scanners.
- `test/prompt-scan.test.ts` (12 tests, stand-in Presidio): bare name masked, client alone misses it, residual catches what presidio alone missed, HTTP 500 / malformed / unreachable refuse, placeholder self-check, residual on/off, constructor checks, start-up check pass and missing IN_AADHAAR, AskSession integration. `test/agent.test.ts`: `await maskPrompt`.
- `test-console/start.cmd` also starts `presidio`.
- Owner runs: `npm test` 111/111 (14:59); dry run 15:04 masked the bare name (`Ask <C_PERSON_1> ...`); Presidio stopped 15:06 → "prompt scanner is not ready, so nothing was sent", exit 2.
- Paid run 15:07: masking fine, but Nemotron asked which file (0 tool calls). Fix: `agent-core.ts` `singleDocumentNote()` (instructions, one document only), tool `file` optional, `AskSession.onlyDocument()` fills it when one document is listed; `agent.test.ts` +1. `npm test` 112/112 (15:09).
- **Live paid run 15:10 PASSED:** tx `9068145D36C5AE0CA84816D2888EEF65D51E47573AEB913A4CE56A1C4A1E3BE6`, `masked 1 PERSON`, Nemotron called the tool on doc-1.txt, 0.01 RLUSD spent.

## 2026-10-24 — P14: --timing on the buyer agent

- New `scripts/timing.ts` (`Timing.add/time/take`, `summarize` with derived `bedrock_and_loop` and `tool.other`, `formatTiming`). `scripts/xrpl.ts`: `PayOptions.onPhase(phase, ms)`; `payAndFetch` reports ledger_connect, quote_402, ledger_network, ledger_prepare, sign, paid_call. `private-ask-core.ts` `sendAsk` forwards it. `agent-core.ts`: `SessionOptions.timing`; tool.total around each call, tool.doc_mask, payment phases as tool.*. `agent.ts`: `--timing off|on|json`, startup = `performance.now()` at the first statement after imports, presidio_check, prompt_mask, agent_invoke; table or one JSON line per request.
- Tests: `test/timing.test.ts` (3), `test/agent.test.ts` +1 (real payAndFetch with stub ledger records the six phases in order). Expected 116. Not run yet.
