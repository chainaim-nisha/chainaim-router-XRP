/**
 * The browser side of paying with Crossmark, bundled into public/wallet.js by
 * scripts/build-wallet.ts (npm run build:wallet). The page imports these
 * functions from /wallet.js. Only the address and its network's CAIP-2 id are
 * kept in localStorage; Crossmark keeps the keys.
 */
import crossmark from "@crossmarkio/sdk";
import type { Answer, Failure } from "./answer.ts";
import { readBalance, type Balance } from "./balance.ts";
import { NO_CROSSMARK, payWith, within, type PayNetwork } from "./pay.ts";

export type { PayNetwork };

const KEY = "privacybuddy.crossmark";
/** How long to look for the Crossmark extension before saying it is not installed. */
const DETECT_MS = 3_000;
/** A Crossmark window the visitor never answers would wait for ever, so every Crossmark call has a time limit. */
const CONNECT_MS = 120_000;
const CONNECT_TIMEOUT = "Crossmark did not answer in time. Nothing was shared.";

export function savedAccount(): { address: string; caip2: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { address?: unknown; caip2?: unknown } | null;
    return v && typeof v.address === "string" && typeof v.caip2 === "string" ? { address: v.address, caip2: v.caip2 } : null;
  } catch {
    return null;
  }
}

/** Ask Crossmark for the account to pay from; caip2 is the network this page pays on. */
export async function connect(caip2: string): Promise<string> {
  if (!(await crossmark.async.detect(DETECT_MS))) throw new Error(NO_CROSSMARK);
  let data: { address?: unknown; meta?: { isRejected?: unknown } } | undefined;
  try {
    data = (await within(crossmark.async.signInAndWait(), CONNECT_MS, CONNECT_TIMEOUT)).response?.data;
  } catch (e) {
    const m = String((e as Error)?.message ?? "");
    if (m === CONNECT_TIMEOUT) throw new Error(CONNECT_TIMEOUT);
    throw new Error(`Crossmark could not connect: ${m.slice(0, 200)}`);
  }
  if (data?.meta?.isRejected === true) throw new Error("You closed Crossmark before connecting. Nothing was shared.");
  const address = data?.address;
  if (typeof address !== "string" || !address) throw new Error("Crossmark did not share an account.");
  try {
    localStorage.setItem(KEY, JSON.stringify({ address, caip2 }));
  } catch {
    /* private window: the page asks again next time */
  }
  return address;
}

export function disconnect(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

export const balance = (address: string, net: PayNetwork): Promise<Balance> => readBalance(address, net.name, { currency: net.asset, issuer: net.issuer });

export function payAndAsk(address: string, net: PayNetwork, masked: string, maxTokens = 512, onSigned?: () => void): Promise<Answer | Failure> {
  return payWith({ signAndWait: (tx) => crossmark.async.signAndWait(tx as never), fetch: (input, init) => fetch(input, init), onSigned }, address, net, masked, maxTokens);
}
