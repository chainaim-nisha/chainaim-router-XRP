/**
 * Asking ChainAim about a document without sending its identifiers: the one
 * path shared by the command line (scripts/private-ask.ts) and the buyer
 * agent's tool (scripts/agent-core.ts).
 *
 *   readDocument   read a .txt/.md file on this machine
 *   prepareAsk     mask the question and the document here, self-check, build the body
 *   sendAsk        pay the paywall's RLUSD price and send only the masked body;
 *                  give back the answer both masked and restored
 *
 * The restore map is returned to the caller and never sent, logged or
 * written to disk. Which of the two answers goes where is the caller's
 * choice: the command line prints the restored one; the agent's tool gives
 * its language model only the masked one.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { detect, maskText, restore } from "./client-mask.ts";
import type { Buyer, PayOptions } from "./xrpl.ts";

export const PATHS = { chat: "/v1/chat/completions", scan: "/v1/privacy/scan", mask: "/v1/privacy/mask" } as const;
export type Endpoint = keyof typeof PATHS;
/** The gateway's limits: 48,000 characters of chat text; 20,000 for scan and mask. */
export const LIMITS: Record<Endpoint, number> = { chat: 48_000, scan: 20_000, mask: 20_000 };
export const TEXT_FILES = new Set([".txt", ".md", ".text"]);
export const DEFAULT_QUESTION = "Explain this document in plain language: what each item means, and anything I should ask about.";
export const MAX_TOKENS_LIMIT = 1024;

/**
 * Refused before anything was sent or paid. `exitCode` is what the command
 * line exits with: 2 for a usage or input problem, 1 when the self-check
 * found a value that should have been masked.
 */
export class AskRefused extends Error {
  readonly exitCode: 1 | 2;
  constructor(message: string, exitCode: 1 | 2 = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function isEndpoint(value: string): value is Endpoint {
  return Object.hasOwn(PATHS, value);
}

/** The document's text. Only plain-text files; an empty file is refused. */
export function readDocument(file: string): string {
  if (!TEXT_FILES.has(extname(file).toLowerCase())) throw new AskRefused(`${file}: only .txt and .md files for now; save the PDF or Word file as plain text first`);
  let document: string;
  try {
    document = readFileSync(file, "utf8");
  } catch (e) {
    throw new AskRefused(`cannot read ${file}: ${(e as Error).message}`);
  }
  if (document.trim() === "") throw new AskRefused(`${file} is empty`);
  return document;
}

export type AskInput = {
  document: string;
  endpoint: Endpoint;
  /** Asked with the document (chat only); masked together with it. */
  question?: string;
  /** Longest chat answer, 1 to 1024. */
  maxTokens?: number;
  /** Mask names found after a label (default true). */
  names?: boolean;
};

export type PreparedAsk = {
  endpoint: Endpoint;
  /** The text that leaves this machine. */
  masked: string;
  /** The JSON body that leaves this machine. */
  bodyText: string;
  /** Placeholder -> original value. Stays on this machine. */
  map: Record<string, string>;
  counts: Record<string, number>;
  cardsRemoved: number;
};

/**
 * Mask the question and document on this machine and build the request body.
 * Refuses when the masked text still holds a value that would be masked again,
 * or is longer than the endpoint takes.
 */
export function prepareAsk(input: AskInput): PreparedAsk {
  const maxTokens = input.maxTokens ?? 512;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS_LIMIT) throw new AskRefused(`--max-tokens must be a whole number from 1 to ${MAX_TOKENS_LIMIT}`);
  // The question is masked together with the document: a name typed in it is a name too.
  const content = input.endpoint === "chat" ? `${input.question ?? DEFAULT_QUESTION}\n\n--- document ---\n${input.document}` : input.document;
  const options = { names: input.names !== false };
  const { masked, map, counts, cardsRemoved } = maskText(content, options);
  // Self-check before anything leaves: the masked text must hold nothing this machine would mask again.
  if (detect(masked, options).length > 0) throw new AskRefused("refusing to send: the masked text still holds a value that should be masked; nothing was sent", 1);
  if (masked.length > LIMITS[input.endpoint]) throw new AskRefused(`the text is ${masked.length} characters after masking; ${input.endpoint} takes at most ${LIMITS[input.endpoint]}; nothing was sent`);
  const body = input.endpoint === "chat" ? { model: "chainaim/auto", messages: [{ role: "user", content: masked }], max_tokens: maxTokens } : { text: masked };
  return { endpoint: input.endpoint, masked, bodyText: JSON.stringify(body), map, counts, cardsRemoved };
}

/** "3 C_PERSON, 1 C_EMAIL", or "" when nothing was masked. */
export function maskSummary(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
}

export type AskOutcome = {
  url: string;
  status: number;
  ok: boolean;
  /** x-chainaim-* response headers. */
  chainaimHeaders: Record<string, string>;
  /** The chat answer as ChainAim returned it: placeholders kept. */
  answerMasked?: string;
  /** The chat answer with this machine's placeholders put back. Never sent anywhere. */
  answerRestored?: string;
  /** Placeholders in the answer this machine did not make. */
  unresolved: number;
  /** The parsed body for scan and mask, or for a chat body without an answer. */
  result?: unknown;
  /** The first 1000 characters of a body that is not JSON, or of a refused call. */
  raw?: string;
  /** RLUSD price signed for, when a payment was presented. */
  amount?: string;
  refusal?: string;
  receipt?: { success: boolean; transaction: string; network: string; payer?: string | null };
};

/** Paying, as scripts/xrpl.ts does it; a parameter so the paying code is loaded only when a call is paid. */
export type PayFn = typeof import("./xrpl.ts").payAndFetch;

/**
 * Pay and send the prepared, masked body to `base` + the endpoint's path.
 * Only `prepared.bodyText` leaves this machine.
 */
export async function sendAsk(base: string, prepared: PreparedAsk, buyer: Buyer, options: PayOptions & { pay?: PayFn } = {}): Promise<AskOutcome> {
  const pay = options.pay ?? (await import("./xrpl.ts")).payAndFetch;
  const url = `${base}${PATHS[prepared.endpoint]}`;
  const { response: r, amount, refusal, receipt } = await pay(url, { method: "POST", headers: { "content-type": "application/json" }, body: prepared.bodyText }, buyer, {
    ...(options.ledger ? { ledger: options.ledger } : {}),
    ...(options.maxAmount !== undefined ? { maxAmount: options.maxAmount } : {}),
  });
  const chainaimHeaders: Record<string, string> = {};
  r.headers.forEach((value, name) => {
    if (name.startsWith("x-chainaim-")) chainaimHeaders[name] = value;
  });
  const common = { url, status: r.status, ok: r.ok, chainaimHeaders, unresolved: 0, ...(amount !== undefined ? { amount } : {}), ...(refusal ? { refusal } : {}), ...(receipt ? { receipt } : {}) };
  const text = await r.text();
  if (!r.ok) return { ...common, raw: text.slice(0, 1000) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...common, raw: text.slice(0, 1000) };
  }
  if (prepared.endpoint !== "chat") return { ...common, result: parsed };
  const answer = (parsed as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof answer !== "string") return { ...common, result: parsed };
  const restored = restore(answer, prepared.map);
  return { ...common, answerMasked: answer, answerRestored: restored.text, unresolved: restored.unresolved };
}
