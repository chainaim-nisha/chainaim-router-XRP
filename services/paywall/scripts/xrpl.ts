/**
 * What the scripts share for the XRP Ledger: which network and account the
 * environment names, the ledger's reserves, and paying a paywall price in
 * RLUSD. The seed is read here and never printed or saved.
 *
 * The repository's .env is read when this file loads (src/env.ts), so no
 * script needs --env-file. A value already in the shell still wins, and is
 * reported by name when it does.
 *
 * XRPL_NETWORK                 testnet (default) or mainnet
 * XRPL_BUYER_SEED_<NETWORK>    the family seed (s...) of the account that signs
 * XRPL_WS_URL_<NETWORK>        the ledger's WebSocket address; TestNet has a default
 * RLUSD_ISSUER_<NETWORK>       the RLUSD issuer; TestNet has a default
 * RLUSD_CURRENCY_CODE          RLUSD's currency code; has a default
 */
import { Client, Wallet } from "xrpl";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, XRPLPresignedPaymentPayer, type XRPLNetworkId } from "x402-xrpl";
import { DEFAULT_RLUSD_CURRENCY_CODE, DEFAULT_RLUSD_ISSUER_TESTNET, NETWORKS, type NetworkName } from "../src/config.ts";
import { loadEnv } from "../src/env.ts";

// Every script reaches the ledger through this file, so the .env is read here,
// once, before any of them asks the environment for a seed or a server.
loadEnv();

export const DEFAULT_WS_URL_TESTNET = "wss://s.altnet.rippletest.net:51233/";

export type ScriptAccount = {
  networkName: NetworkName;
  /** CAIP-2 id: xrpl:1 or xrpl:0. */
  network: XRPLNetworkId;
  wsUrl: string;
  wallet: Wallet;
};

/** A problem with the environment; the scripts print the message and exit with 2. */
export class SetupError extends Error {}

export function networkName(env: Record<string, string | undefined>): NetworkName {
  const chosen = env.XRPL_NETWORK?.trim() || "testnet";
  if (!Object.hasOwn(NETWORKS, chosen)) throw new SetupError("XRPL_NETWORK must be testnet or mainnet");
  return chosen as NetworkName;
}

/** The name of the variable that holds the seed for the chosen network. */
export function seedVariable(env: Record<string, string | undefined>): string {
  return `XRPL_BUYER_SEED_${networkName(env).toUpperCase()}`;
}

export function wsUrl(env: Record<string, string | undefined>): string {
  const name = networkName(env);
  const variable = `XRPL_WS_URL_${name.toUpperCase()}`;
  const url = env[variable]?.trim() || (name === "testnet" ? DEFAULT_WS_URL_TESTNET : undefined);
  if (!url) throw new SetupError(`${variable} is required: the WebSocket address of an XRP Ledger server`);
  if (!/^wss?:\/\//.test(url) || !URL.canParse(url)) throw new SetupError(`${variable} must be a ws(s) URL`);
  return url;
}

/** RLUSD on the chosen network: its currency code and the account that issues it. */
export function rlusd(env: Record<string, string | undefined>): { currency: string; issuer: string } {
  const name = networkName(env);
  const variable = `RLUSD_ISSUER_${name.toUpperCase()}`;
  const issuer = env[variable]?.trim() || (name === "testnet" ? DEFAULT_RLUSD_ISSUER_TESTNET : undefined);
  if (!issuer) throw new SetupError(`${variable} is required: the RLUSD issuer, checked against Ripple's documentation`);
  return { currency: env.RLUSD_CURRENCY_CODE?.trim() || DEFAULT_RLUSD_CURRENCY_CODE, issuer };
}

export function account(env: Record<string, string | undefined>): ScriptAccount {
  const name = networkName(env);
  const variable = seedVariable(env);
  const seed = env[variable]?.trim();
  if (!seed) throw new SetupError(`${variable} is required: the account's family seed (s...)`);
  let wallet: Wallet;
  try {
    wallet = Wallet.fromSeed(seed);
  } catch {
    throw new SetupError(`${variable} is not a valid family seed`); // the cause is dropped: it can quote the seed
  }
  return { networkName: name, network: NETWORKS[name], wsUrl: wsUrl(env), wallet };
}

/** The XRP an account must keep: the base reserve, plus the owner reserve for each object it owns (a trust line is one). */
export async function reserves(client: Client): Promise<{ baseXrp: number; ownerXrp: number }> {
  const { result } = await client.request({ command: "server_info" });
  const ledger = result.info.validated_ledger;
  if (!ledger) throw new Error("the XRP Ledger server has no validated ledger yet; try again shortly");
  return { baseXrp: ledger.reserve_base_xrp, ownerXrp: ledger.reserve_inc_xrp };
}

export type Paid = { response: Response; receipt?: { success: boolean; transaction: string; network: string; payer?: string | null } };

/**
 * Call a paywall route and pay the price it asks: read the PAYMENT-REQUIRED
 * header, sign one RLUSD Payment bound to its invoice, and call again with
 * PAYMENT-SIGNATURE. The paywall's facilitator submits the transaction only
 * when the call is served. A route that asks for no payment is returned as is.
 */
export async function payAndFetch(url: string, init: { method: string; headers: Record<string, string>; body: string }, buyer: ScriptAccount): Promise<Paid> {
  const first = await fetch(url, init);
  const header = first.headers.get("payment-required");
  if (first.status !== 402 || !header) return { response: first };
  const required = decodePaymentRequiredHeader(header);
  const offer = required.accepts.find((a) => a.scheme === "exact" && a.network === buyer.network);
  if (!offer) {
    const asked = required.accepts.map((a) => `${a.scheme} on ${a.network}`).join(", ");
    throw new SetupError(`the paywall asks for ${asked || "nothing this script can pay"}, but XRPL_NETWORK is ${buyer.networkName} (${buyer.network})`);
  }
  const payer = new XRPLPresignedPaymentPayer({ wallet: buyer.wallet, network: buyer.network, wsUrl: buyer.wsUrl });
  const payment = await payer.createPaymentHeader(offer, { resource: required.resource }).catch((e: { data?: { error?: string } }) => {
    if (e?.data?.error !== "actNotFound") throw e;
    throw new SetupError(`the buyer account ${buyer.wallet.classicAddress} is not on ${buyer.networkName} yet: fund it with XRP and open its RLUSD trust line first; nothing was paid`);
  });
  const response = await fetch(url, { ...init, headers: { ...init.headers, "PAYMENT-SIGNATURE": payment } });
  const receipt = response.headers.get("payment-response");
  return { response, receipt: receipt ? decodePaymentResponseHeader(receipt) : undefined };
}
