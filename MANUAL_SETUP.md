# MANUAL SETUP

Steps the owner must do by hand. Append-only.

## 2026-10-13 — before the XRPL migration build can continue

1. **Free disk space on C:.** The drive is at 100% (about 137 MB free). `services/paywall` needs roughly 300 MB for `npm ci`, and the XRPL packages need more. The npm cache at `C:\Users\Admin\AppData\Local\npm-cache` holds 5.2 GB and can be emptied with `npm cache clean --force`.
2. **Make `*.t54.ai` reachable with a trusted certificate.** The Sophos firewall re-signs TLS for `xrpl-facilitator-testnet.t54.ai`, `xrpl-facilitator-mainnet.t54.ai` and `xrpl-x402.t54.ai`. Either exclude these hosts from HTTPS decryption, or export the Sophos root CA to a `.pem` file and point Node at it with `NODE_EXTRA_CA_CERTS`. Check with: `node -e "fetch('https://xrpl-facilitator-testnet.t54.ai/supported').then(r=>r.text()).then(console.log)"`.
3. **Choose the browser wallet** for ARCH-016: Xaman, GemWallet or Crossmark.

## 2026-10-13 — paywall on XRPL/RLUSD (ARCH-010, ARCH-011, ARCH-012)

Items 1 above (disk space) is done. Item 2 (`*.t54.ai` behind the Sophos certificate) is still open.

### Environment variables the paywall service reads (`services/paywall/src/config.ts`)

| Variable | Required | Default | What it is |
|---|---|---|---|
| `XRPL_NETWORK` | no | `testnet` | `testnet` or `mainnet`. Only that network's variables below are read and checked. |
| `XRPL_PAY_TO_TESTNET` / `XRPL_PAY_TO_MAINNET` | yes, for the chosen network | none | The XRPL classic address (`r...`) every route pays. Checksum-verified at start. Must not be the buyer account. |
| `RLUSD_ISSUER_TESTNET` | no | `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV` | RLUSD issuer on TestNet. |
| `RLUSD_ISSUER_MAINNET` | yes on mainnet | none, on purpose | Copy it from Ripple's documentation at deploy time (spec section 3.4). |
| `XRPL_CAIP2_TESTNET` / `XRPL_CAIP2_MAINNET` | no | `xrpl:1` / `xrpl:0` | CAIP-2 network id. |
| `FACILITATOR_URL_TESTNET` / `FACILITATOR_URL_MAINNET` | no | `https://xrpl-facilitator-testnet.t54.ai` / `https://xrpl-facilitator-mainnet.t54.ai` | The t54 x402 facilitator. |
| `RLUSD_CURRENCY_CODE` | no | `524C555344000000000000000000000000000000` | 40 hex characters. |
| `XRPL_SOURCE_TAG` | no | `804681468` | Put on every quoted price; a 32-bit number. |
| `XRPL_MAX_TIMEOUT_SECONDS` | no | `600` | How long a quoted price and its invoice stay payable. |

Unchanged: `CHAINAIM_GATEWAY_KEY`, `GATEWAY_URL`, `PUBLIC_BASE_URL`, `PRICE_SCAN`, `PRICE_MASK`, `PRICE_CHAT`, `GATEWAY_TIMEOUT_MS`, `PORT`, `HOST`.

Retired, remove from Railway: `AVM_PAY_TO`, `X402_NETWORK`, `FACILITATOR_URL`.

### Environment variables only the scripts read (`services/paywall/scripts/xrpl.ts`) — never set on a service, never committed

| Variable | Required | Default | What it is |
|---|---|---|---|
| `XRPL_BUYER_SEED_TESTNET` / `XRPL_BUYER_SEED_MAINNET` | yes, to pay or to run `trust-line.ts` / `send-xrp.ts` | none | Family seed (`s...`) of the account that signs. Replaces `AVM_MNEMONIC`. |
| `XRPL_WS_URL_TESTNET` | no | `wss://s.altnet.rippletest.net:51233/` | XRPL WebSocket server. |
| `XRPL_WS_URL_MAINNET` | yes on mainnet | none | XRPL WebSocket server for MainNet. |

### Owner steps on TestNet (spec Stage 2 and Stage 3) — not done by the agent

1. Make two accounts, buyer and pay-to: `node scripts/new-account.ts` twice, in `services/paywall`. Save each seed in a password manager.
2. Fund both with TestNet XRP from the XRPL TestNet faucet: `https://xrpl.org/resources/dev-tools/xrp-faucets`.
3. Open an RLUSD trust line on each: put that account's seed in `XRPL_BUYER_SEED_TESTNET` and run `node scripts/trust-line.ts`.
4. Get TestNet RLUSD into the buyer account from Ripple's RLUSD TestNet faucet, `https://tryrlusd.com/` (the address Ripple's RLUSD developer documentation links to).
5. Set `XRPL_PAY_TO_TESTNET` on the paywall, start it, then run `node scripts/pay.ts --dry-run URL` and `node scripts/pay.ts URL '{"text":"..."}'` with the buyer seed. A settled payment here is the proof the agent could not produce (see STATE.md).

## 2026-10-13 — web page on Crossmark (ARCH-015, ARCH-016)

No new environment variable: `services/web` still reads only `PAYWALL_URL`, `PORT` and `HOST`.

1. Install the Crossmark browser extension (`https://crossmark.io`) and make or import a TestNet account in it. This is the buyer; do not use the pay-to account.
2. Fund it with TestNet XRP, open its RLUSD trust line and get TestNet RLUSD, as in the owner steps above.
3. Start the paywall and the web app, open the page, click **Connect Crossmark**, mask a message and press **Execute**. This is the first time the Crossmark path runs for real; the agent could only test it with a stand-in.
4. On Vercel, redeploy `services/web` so the new `public/wallet.js` and security headers go live.
5. Review the disclaimer sentence in `services/web/public/index.html` that now names "Ripple, the XRPL Foundation".
