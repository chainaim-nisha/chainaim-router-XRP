/**
 * A tenant's buyer agent (L1): a Strands agent on Amazon Bedrock with one tool,
 * chainaim_private_ask. Ask it about a document in the tenant's docs folder;
 * the tool masks the document on this computer, pays ChainAim in RLUSD from
 * the tenant's wallet, and sends only the masked text. The agent's model sees
 * the masked answer; this computer shows it with the real values put back.
 * Logic in scripts/agent-core.ts.
 *
 *   node scripts/agent.ts --tenant t02 --dry-run --prompt "What does my discharge note say about follow-up?"
 *   node scripts/agent.ts --tenant t02 --url http://127.0.0.1:8080 --prompt "..."
 *   node scripts/agent.ts --tenant t02 --url http://127.0.0.1:8080          (type questions; an empty line ends)
 *
 * --tenant            tenant id: a folder under --tenants (required)
 * --tenants           folder of tenant folders (default: rig/tenants at the repository root)
 * --docs              the tenant's documents (default: <tenants>/<tenant>/docs)
 * --url               the paywall's http(s) address (required unless --dry-run)
 * --prompt            one request to the agent; without it, requests are read line by line
 * --region            AWS region the Bedrock calls go to (default us-east-1)
 * --model-id          Bedrock model or inference profile id (default global.anthropic.claude-sonnet-4-6,
 *                     the Strands SDK 1.20.0 default, pinned here so an SDK update cannot change it)
 * --agent-max-tokens  longest reply from the agent's model, 1 to 8192 (default 1024)
 * --max-turns         most model calls per request, 1 to 20 (default 6)
 * --max-spend         the most RLUSD this session may pay ChainAim (default 0.05)
 * --max-tokens        longest ChainAim answer, 1 to 1024 (default 512)
 * --no-names          do not mask names found after a label
 * --show-masked       also print what left this computer and ChainAim's masked answer
 * --dry-run           mask and show what would be sent; pay and send nothing (Bedrock is still called)
 *
 * The tenant's seed is read from the variable its tenant.json names
 * (seedPrefix + _TESTNET or _MAINNET), as in the test rig, and never printed.
 * Bedrock credentials come from the AWS SDK's usual chain (AWS_PROFILE,
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, SSO); none is read here.
 * Exit code: 0 when every request was answered, 1 when the agent failed,
 * 2 for a set-up problem found before the agent ran.
 */
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BedrockModel } from "@strands-agents/sdk";
import { AskSession, buildAgent, listDocuments, TOOL_NAME, type Shown } from "./agent-core.ts";
import { AskRefused } from "./private-ask-core.ts";
import { loadTenants } from "./rig-core.ts";
import { account, SetupError, seedBuyer, type Buyer } from "./xrpl.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    tenants: { type: "string", default: join(REPO, "rig", "tenants") },
    docs: { type: "string" },
    url: { type: "string" },
    prompt: { type: "string" },
    region: { type: "string", default: "us-east-1" },
    "model-id": { type: "string", default: "global.anthropic.claude-sonnet-4-6" },
    "agent-max-tokens": { type: "string", default: "1024" },
    "max-turns": { type: "string", default: "6" },
    "max-spend": { type: "string", default: "0.05" },
    "max-tokens": { type: "string", default: "512" },
    "no-names": { type: "boolean", default: false },
    "show-masked": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function whole(name: string, raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < min || n > max) fail(`--${name} must be a whole number from ${min} to ${max}`);
  return n;
}

const tenantId = values.tenant ?? fail("usage: node scripts/agent.ts --tenant t01 [--url http://127.0.0.1:8080] [--prompt \"...\"] [--dry-run]");
const dryRun = values["dry-run"] === true;
const base = values.url?.replace(/\/+$/, "");
if (!dryRun && (!base || !/^https?:\/\//.test(base) || !URL.canParse(base))) fail("--url is required and must be the paywall's http(s) address, e.g. http://127.0.0.1:8080");
const agentMaxTokens = whole("agent-max-tokens", values["agent-max-tokens"], 1, 8192);
const maxTurns = whole("max-turns", values["max-turns"], 1, 20);
const maxTokens = whole("max-tokens", values["max-tokens"], 1, 1024);
const showMasked = values["show-masked"] === true;

function show(s: Shown): void {
  console.log(`[${TOOL_NAME}] ${s.file}: ${s.status}${s.amount ? `, ${s.amount} RLUSD` : ""}${s.transaction ? `, tx ${s.transaction}` : ""}${s.reason ? `: ${s.reason}` : ""}`);
  if (s.masked !== undefined && (showMasked || s.status === "dry_run")) {
    console.log("--- what would leave this computer (masked) ---");
    console.log(s.masked);
    console.log("--- end ---");
  }
  if (s.answerMasked !== undefined && showMasked) {
    console.log("--- ChainAim's answer as the agent sees it (placeholders kept) ---");
    console.log(s.answerMasked);
    console.log("--- end ---");
  }
  if (s.answerRestored !== undefined) {
    console.log("--- ChainAim's answer (names put back on this computer) ---");
    console.log(s.answerRestored);
    console.log("--- end ---");
    if (s.unresolved) console.log(`${s.unresolved} placeholder(s) in the answer were not ones this computer made, so they were left as they are`);
  }
}

let session: AskSession;
let tenantName: string;
let documents: string[];
let buyer: Buyer | undefined;
try {
  const [tenant] = loadTenants(values.tenants, [tenantId]);
  tenantName = tenant.name;
  const docsDir = values.docs ?? join(values.tenants, tenant.id, "docs");
  documents = listDocuments(docsDir);
  if (documents.length === 0) throw new AskRefused(`no .txt or .md documents in ${docsDir}`);
  if (!dryRun) buyer = seedBuyer(account(process.env, { seedPrefix: tenant.seedPrefix }));
  session = new AskSession({ docsDir, base, buyer, maxSpend: values["max-spend"], maxTokens, names: values["no-names"] !== true, dryRun, show });
} catch (e) {
  if (!(e instanceof SetupError) && !(e instanceof AskRefused)) throw e;
  fail(e.message);
}

const model = new BedrockModel({ region: values.region, modelId: values["model-id"], maxTokens: agentMaxTokens });
const agent = buildAgent({ model, session, tenantName, documents });

console.log(`tenant ${tenantId} (${tenantName})${buyer ? `: payer ${buyer.signer.classicAddress} on ${buyer.network}` : ""}`);
console.log(`model ${values["model-id"]} on Bedrock in ${values.region}; documents: ${documents.join(", ")}`);
console.log(dryRun ? "dry run: nothing will be sent to ChainAim or paid" : `paying ${base} at most ${values["max-spend"]} RLUSD this session`);

async function ask(prompt: string): Promise<boolean> {
  try {
    const result = await agent.invoke(prompt, { limits: { turns: maxTurns } });
    const reply = session.restoreForDisplay(result.toString());
    console.log("--- agent (names put back on this computer) ---");
    console.log(reply.text);
    console.log("--- end ---");
    if (reply.unresolved > 0) console.log(`${reply.unresolved} placeholder(s) in the reply could not be put back`);
    if (result.stopReason !== "endTurn") console.log(`the agent stopped: ${result.stopReason}`);
    return true;
  } catch (e) {
    console.error(`the agent failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

// process.exitCode, not process.exit(), after a network call: exiting right after one crashes Node on Windows.
let allOk = true;
if (values.prompt !== undefined) {
  allOk = await ask(values.prompt);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    const line = (await rl.question("you> ")).trim();
    if (line === "") break;
    allOk = (await ask(line)) && allOk;
  }
  rl.close();
}
console.log(`session: ${session.calls} tool call(s), spent ${session.spentDecimal()} RLUSD`);
process.exitCode = allOk ? 0 : 1;
