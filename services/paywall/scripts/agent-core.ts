/**
 * A tenant's buyer agent (L1): a Strands agent with one tool,
 * chainaim_private_ask. The command line is scripts/agent.ts; this file
 * holds the tool, the session it pays from, and the agent's construction,
 * so the tests can drive them in-process.
 *
 * What the agent's language model sees, and what it never sees:
 *
 *   sees   the user's prompt, the names of the files in the tenant's docs
 *          folder, the file and question it passes to the tool, and the tool's
 *          result: ChainAim's answer with the placeholders (<C_PERSON_1>, ...)
 *          left in, plus the payment's amount and transaction
 *   never  a document's text, the restore map, or an answer with the
 *          original values put back
 *
 * The tool reads the document itself, masks it on this machine
 * (scripts/private-ask-core.ts), pays the paywall in RLUSD and sends only the
 * masked text. The restored answer goes to `show`, which prints it on this
 * machine; it is not returned to the model. Anything the user types into the
 * prompt itself does reach the model, as any prompt does.
 *
 * Payments run one at a time per session: one XRP Ledger account numbers
 * its transactions, and the session's RLUSD ceiling is checked before each
 * payment is signed.
 */
import { realpathSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Agent, tool, type Model } from "@strands-agents/sdk";
import { z } from "zod";
import { restore } from "./client-mask.ts";
import { AskRefused, maskSummary, prepareAsk, readDocument, sendAsk, TEXT_FILES, type PayFn } from "./private-ask-core.ts";
import { decimalUnits as units, SetupError, unitsToDecimal as decimal, type Buyer, type PayOptions } from "./xrpl.ts";

export const TOOL_NAME = "chainaim_private_ask";

/**
 * The path of `file` inside the docs folder, after following links. Refuses
 * anything outside it, so the model cannot have the tool read and send any
 * other file on this machine.
 */
export function resolveDocument(docsDir: string, file: string): string {
  let root: string;
  try {
    root = realpathSync(docsDir);
  } catch (e) {
    throw new AskRefused(`cannot open the docs folder ${docsDir}: ${(e as Error).message}`);
  }
  let real: string;
  try {
    real = realpathSync(resolve(root, file));
  } catch {
    throw new AskRefused(`no file "${file}" in the docs folder`);
  }
  const rel = relative(root, real);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new AskRefused(`"${file}" is outside the docs folder; only files in it can be asked about`);
  if (!statSync(real).isFile()) throw new AskRefused(`"${file}" is not a file`);
  return real;
}

/** The plain-text files directly in the docs folder, by name. */
export function listDocuments(docsDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(docsDir);
  } catch (e) {
    throw new AskRefused(`cannot read the docs folder ${docsDir}: ${(e as Error).message}`);
  }
  return names.filter((n) => TEXT_FILES.has(n.slice(n.lastIndexOf(".")).toLowerCase()) && statSync(join(docsDir, n)).isFile()).sort();
}

/** One tool call, as shown on this machine. Holds the restored answer: never handed to the model. */
export type Shown = {
  file: string;
  question: string;
  status: "answered" | "dry_run" | "refused" | "failed";
  masked?: string;
  answerMasked?: string;
  answerRestored?: string;
  unresolved?: number;
  amount?: string;
  transaction?: string;
  reason?: string;
};

/** What the model receives from the tool. Never a document text or a restored value. */
export type ToolReply =
  | { status: "answered"; answer: string; note: string; paid: string | null; transaction: string | null; spent: string; remaining: string }
  | { status: "dry_run"; masked: string; characters: number; note: string }
  | { status: "refused"; reason: string; spent: string; remaining: string }
  | { status: "failed"; reason: string; httpStatus?: number; spent: string; remaining: string };

export type SessionOptions = {
  /** The tenant's docs folder; the tool reads only files inside it. */
  docsDir: string;
  /** The paywall's base address. Required unless dryRun. */
  base?: string;
  /** Who pays. Required unless dryRun. */
  buyer?: Buyer;
  /** The most RLUSD this session may spend. */
  maxSpend: string;
  /** Longest ChainAim answer, 1 to 1024. */
  maxTokens: number;
  /** Mask names found after a label. */
  names: boolean;
  /** Mask and report what would be sent; pay and send nothing. */
  dryRun: boolean;
  /** Called after every tool call with what to show on this machine. */
  show: (shown: Shown) => void;
  /** Ledger reads for payments; by default one connection per payment. */
  ledger?: PayOptions["ledger"];
  /** How payments are made; scripts/xrpl.ts payAndFetch by default. */
  pay?: PayFn;
};

const PLACEHOLDER_NOTE =
  "Values like <C_PERSON_1> stand for details kept on the user's computer. Repeat them exactly as written; the user's computer puts the real values back. Do not guess what they stand for.";

/**
 * One agent session's paying and asking. `ask` is the tool's body.
 */
export class AskSession {
  readonly options: SessionOptions;
  readonly ceiling: bigint;
  spent = 0n;
  calls = 0;
  /** Each answered call's restore map, kept on this machine to restore the agent's own reply for display. */
  private readonly maps: Record<string, string>[] = [];
  /** Tool calls run one after another, whatever order the agent issues them in. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: SessionOptions) {
    this.options = options;
    this.ceiling = units(options.maxSpend);
    if (this.ceiling <= 0n) throw new AskRefused("--max-spend must be above 0");
    if (!options.dryRun && (!options.base || !options.buyer)) throw new AskRefused("a paying session needs the paywall's address and a buyer");
  }

  spentDecimal(): string {
    return decimal(this.spent);
  }

  remaining(): string {
    return decimal(this.ceiling - this.spent);
  }

  ask(file: string, question: string): Promise<ToolReply> {
    const run = this.queue.then(() => this.askNow(file, question));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async askNow(file: string, question: string): Promise<ToolReply> {
    this.calls++;
    const o = this.options;
    const money = (): { spent: string; remaining: string } => ({ spent: this.spentDecimal(), remaining: this.remaining() });
    let prepared;
    try {
      const path = resolveDocument(o.docsDir, file);
      prepared = prepareAsk({ document: readDocument(path), endpoint: "chat", question, maxTokens: o.maxTokens, names: o.names });
    } catch (e) {
      if (!(e instanceof AskRefused)) throw e;
      o.show({ file, question, status: "refused", reason: e.message });
      return { status: "refused", reason: e.message, ...money() };
    }

    if (o.dryRun) {
      o.show({ file, question, status: "dry_run", masked: prepared.masked });
      return { status: "dry_run", masked: maskSummary(prepared.counts) || "nothing found", characters: prepared.masked.length, note: "Dry run: nothing was sent to ChainAim and nothing was paid." };
    }

    let outcome;
    try {
      outcome = await sendAsk(o.base!, prepared, o.buyer!, { ledger: o.ledger, maxAmount: this.remaining(), pay: o.pay });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      // A SetupError is raised before anything is paid: the ceiling, an unfunded account, the wrong network, a signer problem.
      const status = e instanceof SetupError ? "refused" : "failed";
      o.show({ file, question, status, reason });
      return { status, reason, ...money() };
    }

    if (outcome.receipt?.success === true && outcome.amount !== undefined) this.spent += units(outcome.amount);
    if (!outcome.ok || outcome.answerMasked === undefined) {
      const reason = outcome.refusal ? `refused by the paywall: ${outcome.refusal}` : outcome.ok ? "ChainAim's reply held no answer" : `HTTP ${outcome.status} from the paywall`;
      o.show({ file, question, status: "failed", reason, amount: outcome.amount, transaction: outcome.receipt?.transaction });
      return { status: "failed", reason, httpStatus: outcome.status, ...money() };
    }

    this.maps.push(prepared.map);
    o.show({
      file,
      question,
      status: "answered",
      answerMasked: outcome.answerMasked,
      answerRestored: outcome.answerRestored,
      unresolved: outcome.unresolved,
      amount: outcome.amount,
      transaction: outcome.receipt?.transaction,
    });
    return {
      status: "answered",
      answer: outcome.answerMasked,
      note: PLACEHOLDER_NOTE,
      paid: outcome.receipt?.success === true ? (outcome.amount ?? null) : null,
      transaction: outcome.receipt?.transaction ?? null,
      ...money(),
    };
  }

  /**
   * The agent's reply with this session's placeholders put back, for display
   * on this machine only. Each call masks its own document, so the same
   * placeholder can stand for different values in two calls: such a
   * placeholder is left as it is and counted as unresolved.
   */
  restoreForDisplay(text: string): { text: string; unresolved: number } {
    const merged: Record<string, string> = {};
    const clashing = new Set<string>();
    for (const map of this.maps) {
      for (const [key, value] of Object.entries(map)) {
        if (key in merged && merged[key] !== value) clashing.add(key);
        else merged[key] = value;
      }
    }
    for (const key of clashing) delete merged[key];
    return restore(text, merged);
  }
}

/** The tool the agent calls. Its result is the session's ToolReply. */
export function askTool(session: AskSession) {
  return tool({
    name: TOOL_NAME,
    description:
      "Ask ChainAim a question about one of the user's documents. The tool reads the document on the user's computer, masks personal details there, pays ChainAim in RLUSD on the XRP Ledger, and returns ChainAim's answer with the personal details still masked. You never see the document itself.",
    inputSchema: z.object({
      file: z.string().min(1).describe("The document's file name, exactly as listed in the docs folder."),
      question: z
        .string()
        .min(1)
        .max(2000)
        .describe("What to ask about the document. Do not put personal details (names, numbers, e-mail addresses) in the question."),
    }),
    callback: (input) => session.ask(input.file, input.question),
  });
}

/** The instructions the agent's model is given. Lists file names only. */
export function systemPrompt(tenantName: string, documents: readonly string[]): string {
  return [
    `You are the assistant of ${tenantName}. You answer questions about the user's documents using one tool, ${TOOL_NAME}.`,
    `Documents in the user's docs folder: ${documents.length > 0 ? documents.join(", ") : "(none)"}.`,
    "You cannot read the documents yourself. To answer a question about one, call the tool with its file name and a question.",
    "Never ask the user to paste a document or its personal details into the chat.",
    "Keep questions to the tool free of personal details.",
    PLACEHOLDER_NOTE,
    "Each tool call is paid. Call the tool only when the question needs a document, at most once per document unless the user asks again. If the tool refuses or fails, tell the user why and do not retry the same call.",
  ].join("\n");
}

export type AgentParts = { model: Model; session: AskSession; tenantName: string; documents: readonly string[] };

/** A Strands agent with the one tool. Tools run one at a time; the SDK's console printer is off, the caller prints. */
export function buildAgent(parts: AgentParts): Agent {
  return new Agent({
    model: parts.model,
    tools: [askTool(parts.session)],
    systemPrompt: systemPrompt(parts.tenantName, parts.documents),
    toolExecutor: "sequential",
    printer: false,
  });
}
