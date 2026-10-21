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
