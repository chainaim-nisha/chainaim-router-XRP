/**
 * Local test console for the ChainAim stack running in Docker on this PC.
 * Serves one page and forwards its calls: scan, mask and chat to the gateway
 * (adding the local test key), unpaid calls to the paywall (to show the 402),
 * the spy stand-in's record of what left, the last ledger lines, and the
 * gateway's model list with this console's default model (the page's pick list).
 *
 *   node server.ts [--default-model ID] [--models-file PATH] [--port N] [--gateway URL] [--paywall URL] [--spy URL]
 *
 *   --default-model ID  model the pick list starts on until you pick another
 *                       (default: defaultModel in --models-file; chainaim/auto = let the gateway rank)
 *   --models-file PATH  local model registry       (default ../../config/local-models.json, from this folder)
 *   --generated-summary PATH  output budget of the last local-model switch (default ../../config/generated/summary.json)
 *   --port N            console port                (default 8730)
 *   --gateway URL       gateway                     (default http://127.0.0.1:8720)
 *   --paywall URL       paywall                     (default http://127.0.0.1:8080)
 *   --spy URL           stand-in's record           (default http://127.0.0.1:5004)
 *   --view-max N        HTML pages from answers kept in memory for "Open page" links (default 20; oldest dropped first)
 *   --view-ttl-min N    minutes a page link stays valid  (default 60)
 *   --view-max-bytes N  largest page accepted         (default 1000000)
 *   --view-script-src S space-separated https origins a page may load scripts and styles from
 *                       (default "https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com")
 *
 *   --data-config PATH  data folders the page may browse and read (default ../../config/data-sources.json):
 *                       allowedRoots, defaultFolder, defaultMode (whole|pick), extensions, maxBytes, exclude, maxFiles.
 *                       Re-read on every call.
 *
 *   Pages are served at /view/<id> with a sandbox Content-Security-Policy: their scripts run in an opaque
 *   origin and connect-src is 'none', so model-written HTML cannot call this console, the gateway or any
 *   other address. Pages live in memory only (they can hold statement data) and vanish on restart.
 *
 *   node server.ts  ->  http://127.0.0.1:8730
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    "default-model": { type: "string" },
    "models-file": { type: "string", default: fileURLToPath(new URL("../../config/local-models.json", import.meta.url)) },
    "generated-summary": { type: "string", default: fileURLToPath(new URL("../../config/generated/summary.json", import.meta.url)) },
    port: { type: "string", default: "8730" },
    gateway: { type: "string", default: "http://127.0.0.1:8720" },
    paywall: { type: "string", default: "http://127.0.0.1:8080" },
    spy: { type: "string", default: "http://127.0.0.1:5004" },
    "data-config": { type: "string", default: fileURLToPath(new URL("../../config/data-sources.json", import.meta.url)) },
    "view-max": { type: "string", default: "20" },
    "view-ttl-min": { type: "string", default: "60" },
    "view-max-bytes": { type: "string", default: "1000000" },
    "view-script-src": { type: "string", default: "https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com" },
  },
});
function positiveInt(name: "view-max" | "view-ttl-min" | "view-max-bytes"): number {
  const n = Number(flags[name]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer, got ${flags[name]}`);
  return n;
}
const VIEW_MAX = positiveInt("view-max");
const VIEW_TTL_MS = positiveInt("view-ttl-min") * 60_000;
const VIEW_MAX_BYTES = positiveInt("view-max-bytes");
const VIEW_SOURCES = flags["view-script-src"]!.split(/\s+/).filter(Boolean);
for (const s of VIEW_SOURCES) {
  if (!URL.canParse(s) || new URL(s).protocol !== "https:" || new URL(s).origin !== s.replace(/\/+$/, "")) throw new Error(`--view-script-src entries must be https origins like https://cdn.jsdelivr.net, got ${s}`);
}
for (const name of ["gateway", "paywall", "spy"] as const) {
  if (!URL.canParse(flags[name]!)) throw new Error(`--${name} must be a URL, got ${flags[name]}`);
}
const PORT = Number(flags.port);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error(`--port must be 1 to 65535, got ${flags.port}`);
/** The registry's defaultModel, so the pick list follows config/local-models.json; chainaim/auto when it cannot be read. */
function registryDefault(path: string): string {
  try {
    const text = readFileSync(path, "utf8");
    const id = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).defaultModel;
    return typeof id === "string" && id ? id : "chainaim/auto";
  } catch {
    return "chainaim/auto";
  }
}
const DEFAULT_MODEL = (flags["default-model"] ?? registryDefault(flags["models-file"]!)).trim();
/** The output budget the last switch gave the gateway (config/generated/summary.json), or null outside the local-model mode. Read per call, so a switch needs no console restart. */
function generatedMaxOutput(): number | null {
  try {
    const text = readFileSync(flags["generated-summary"]!, "utf8");
    const n = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).maxOutputTokens;
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

const KEY = readFileSync(new URL("../local-gateway-key.txt", import.meta.url), "utf8").trim();
const GATEWAY = flags.gateway!.replace(/\/+$/, "");
const PAYWALL = flags.paywall!.replace(/\/+$/, "");
const SPY = flags.spy!.replace(/\/+$/, "");
const PAGE = new URL("./index.html", import.meta.url);

const ROUTES: Record<string, string> = { scan: "/v1/privacy/scan", mask: "/v1/privacy/mask", chat: "/v1/chat/completions" };

// "Open page" links: HTML pages found in model answers, kept in memory only, served sandboxed.
const views = new Map<string, { html: string; at: number }>();
function pruneViews(now = Date.now()): void {
  for (const [id, v] of views) if (now - v.at > VIEW_TTL_MS) views.delete(id);
  while (views.size > VIEW_MAX) views.delete(views.keys().next().value as string);
}
const VIEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VIEW_CSP = [
  "sandbox allow-scripts", // opaque origin: no access to this console's origin, storage or cookies
  "default-src 'none'",
  `script-src 'unsafe-inline' ${VIEW_SOURCES.join(" ")}`,
  `style-src 'unsafe-inline' ${VIEW_SOURCES.join(" ")} https://fonts.googleapis.com`,
  "font-src https://fonts.gstatic.com data:",
  "img-src data: blob:",
  "connect-src 'none'", // no fetch/XHR/WebSocket: the page cannot reach the console, the gateway or the internet
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");
const viewHeaders = { "content-security-policy": VIEW_CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store" };

// ---- From data folder ------------------------------------------------------------------------------
// The page only NAMES a folder or file; this server decides. Only paths inside allowedRoots (the data config, re-read on
// every call so edits need no restart) are listed or read, after resolving links. Read-only; nothing is created.
type DataConfig = { allowedRoots: string[]; defaultFolder: string; extensions: string[]; maxBytes: Record<string, number>; exclude: RegExp[]; excludeText: string[]; maxFiles: number; defaultMode: "whole" | "pick" };
const fold = (p: string): string => (process.platform === "win32" ? p.toLowerCase() : p);
function within(child: string, root: string): boolean {
  const r = relative(fold(root), fold(child));
  return r === "" || (r !== ".." && !r.startsWith(".." + sep) && !isAbsolute(r));
}
const globToRe = (g: string): RegExp => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
function readDataConfig(): { config?: DataConfig; error?: string } {
  let raw: Record<string, any>;
  try {
    const text = readFileSync(flags["data-config"]!, "utf8");
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    return { error: `Data folders are off: cannot read ${flags["data-config"]} (${(e as Error).message}). Copy config/data-sources.example.json to config/data-sources.json.` };
  }
  const roots: string[] = Array.isArray(raw.allowedRoots) ? raw.allowedRoots.filter((r: unknown) => typeof r === "string" && isAbsolute(r)).map((r: string) => resolve(r)) : [];
  if (!roots.length) return { error: "Data folders are off: allowedRoots must list at least one absolute folder." };
  const defaultFolder = typeof raw.defaultFolder === "string" && isAbsolute(raw.defaultFolder) ? resolve(raw.defaultFolder) : roots[0];
  if (!roots.some((r) => within(defaultFolder, r))) return { error: `Data folders are off: defaultFolder ${defaultFolder} is not inside allowedRoots.` };
  const extensions: string[] = (Array.isArray(raw.extensions) ? raw.extensions : [".csv", ".tsv", ".txt", ".pdf"]).map((e: unknown) => String(e).toLowerCase());
  const maxBytes: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw.maxBytes ?? {})) if (Number.isInteger(v) && (v as number) > 0) maxBytes[k.toLowerCase()] = v as number;
  maxBytes["*"] ??= 2_000_000;
  const excludeText: string[] = Array.isArray(raw.exclude) ? raw.exclude.map(String) : [];
  const maxFiles = Number.isInteger(raw.maxFiles) && raw.maxFiles > 0 ? raw.maxFiles : 500;
  const defaultMode = raw.defaultMode === "pick" ? "pick" : "whole"; // whole: every file in the folder goes with each question
  return { config: { allowedRoots: roots, defaultFolder, extensions, maxBytes, exclude: excludeText.map(globToRe), excludeText, maxFiles, defaultMode } };
}
class DataError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
/** The real location of a requested path, which must be inside an allowed root. The lexical check runs first, so a path outside the roots is refused without touching the disk; the real-path check then catches links that lead out. */
async function insideRoots(p: string, cfg: DataConfig): Promise<string> {
  if (!p || !isAbsolute(p)) throw new DataError(400, "path must be an absolute path");
  const asked = resolve(p);
  if (!cfg.allowedRoots.some((r) => within(asked, r))) throw new DataError(403, "outside the allowed data folders (allowedRoots in the data config)");
  let real: string;
  try { real = await realpath(asked); } catch { throw new DataError(404, `not found: ${asked}`); }
  for (const r of cfg.allowedRoots) {
    let rootReal: string;
    try { rootReal = await realpath(r); } catch { continue; }
    if (within(real, rootReal)) return real;
  }
  throw new DataError(403, "this path leads outside the allowed data folders (a link?)");
}
const usableName = (file: string, cfg: DataConfig): boolean => cfg.extensions.includes(extname(file).toLowerCase()) && !cfg.exclude.some((re) => re.test(basename(file)));
const capFor = (file: string, cfg: DataConfig): number => cfg.maxBytes[extname(file).toLowerCase()] ?? cfg.maxBytes["*"];
/** Only this console's own address may use the data routes, so a site reached through DNS rebinding cannot read files. */
const hostOk = (req: IncomingMessage): boolean => { const h = (req.headers.host ?? "").toLowerCase(); return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`; };
const dataHeaders = { "x-content-type-options": "nosniff", "cache-control": "no-store" };
function dataJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", ...dataHeaders });
  res.end(JSON.stringify(body));
}
async function isFolder(p: string): Promise<boolean> { try { return (await stat(p)).isDirectory(); } catch { return false; } }

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://console");
    const [, api, name] = url.pathname.split("/");
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(PAGE));
      return;
    }
    // The pick list: every model the gateway serves now, plus this console's default.
    if (api === "gateway" && name === "models" && req.method === "GET") {
      const r = await fetch(GATEWAY + "/v1/models", { headers: { authorization: `Bearer ${KEY}` } });
      const body = (await r.json().catch(() => null)) as { data?: { id?: unknown; context_length?: unknown }[] } | null;
      const data = body?.data ?? [];
      const models = data.map((m) => m.id).filter((id): id is string => typeof id === "string");
      // Context length per model and the gateway's output budget let the page warn before a prompt is too big.
      const limits = Object.fromEntries(data.filter((m) => typeof m.id === "string" && typeof m.context_length === "number").map((m) => [m.id, m.context_length]));
      json(res, 200, { status: r.status, defaultModel: DEFAULT_MODEL, models, limits, maxOutputTokens: generatedMaxOutput() });
      return;
    }
    if (api === "gateway" && req.method === "POST" && ROUTES[name]) {
      const r = await fetch(GATEWAY + ROUTES[name], {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: await readBody(req),
      });
      const headers = Object.fromEntries([...r.headers].filter(([k]) => k.startsWith("x-chainaim")));
      json(res, 200, { status: r.status, headers, body: await r.json().catch(() => null) });
      return;
    }
    if (api === "paywall" && ROUTES[name]) {
      const body = name === "chat" ? { messages: [{ role: "user", content: "hi" }] } : { text: "hi" };
      const r = await fetch(PAYWALL + ROUTES[name], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const header = r.headers.get("payment-required");
      const required = header ? JSON.parse(Buffer.from(header, "base64").toString("utf8")) : null;
      json(res, 200, {
        status: r.status,
        accepts: required?.accepts?.map((a: Record<string, any>) => ({ price: Number(a.amount) / 1e6, network: a.network, asset: a.asset, payTo: a.payTo, tag: a.extra?.tag })) ?? [],
        bazaar: Boolean(required?.extensions?.bazaar),
        body: header ? null : await r.json().catch(() => null),
      });
      return;
    }
    // Store one HTML page from an answer. JSON only, so a cross-site page cannot post here without a CORS preflight (which this server never grants).
    if (api === "view" && !name && req.method === "POST") {
      if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return json(res, 415, { error: "send application/json" });
      const raw = await readBody(req);
      if (Buffer.byteLength(raw) > VIEW_MAX_BYTES + 1024) return json(res, 413, { error: `page over --view-max-bytes (${VIEW_MAX_BYTES})` });
      let html: unknown;
      try { html = JSON.parse(raw).html; } catch { return json(res, 400, { error: 'body must be JSON {"html": "..."}' }); }
      if (typeof html !== "string" || !html.includes("<")) return json(res, 400, { error: "html must be a string of HTML" });
      if (Buffer.byteLength(html) > VIEW_MAX_BYTES) return json(res, 413, { error: `page over --view-max-bytes (${VIEW_MAX_BYTES})` });
      pruneViews();
      const id = randomUUID();
      views.set(id, { html, at: Date.now() });
      pruneViews();
      json(res, 200, { url: `/view/${id}`, expiresInMin: VIEW_TTL_MS / 60_000 });
      return;
    }
    if (api === "view" && name && req.method === "GET") {
      pruneViews();
      const page = VIEW_ID.test(name) ? views.get(name) : undefined;
      if (!page) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...viewHeaders });
        res.end("This page has expired or the test console was restarted. Ask the question again to get a new link.");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...viewHeaders });
      res.end(page.html);
      return;
    }
    // From data folder: config, sub-folders, files, one file. GET only, read-only, confined to allowedRoots.
    if (api === "data" && req.method === "GET") {
      if (!hostOk(req)) return dataJson(res, 403, { error: `open the console as http://127.0.0.1:${PORT}` });
      const { config, error } = readDataConfig();
      if (name === "config") {
        return dataJson(res, 200, config
          ? { enabled: true, allowedRoots: config.allowedRoots, defaultFolder: config.defaultFolder, defaultExists: await isFolder(config.defaultFolder), extensions: config.extensions, maxBytes: config.maxBytes, exclude: config.excludeText, maxFiles: config.maxFiles, defaultMode: config.defaultMode }
          : { enabled: false, error });
      }
      if (!config) return dataJson(res, 503, { error });
      try {
        const p = url.searchParams.get("path") ?? "";
        if (name === "folders") {
          if (!p) return dataJson(res, 200, { path: "", parent: null, folders: config.allowedRoots.map((r) => ({ name: r, path: r })) });
          const dir = await insideRoots(p, config);
          if (!(await isFolder(dir))) throw new DataError(400, "not a folder");
          const folders = (await readdir(dir, { withFileTypes: true }))
            .filter((e) => e.isDirectory() && !e.isSymbolicLink())
            .map((e) => ({ name: e.name, path: join(dir, e.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
          const up = dirname(dir);
          return dataJson(res, 200, { path: dir, parent: up !== dir && config.allowedRoots.some((r) => within(up, r)) ? up : "", folders });
        }
        if (name === "files") {
          const dir = await insideRoots(p, config);
          if (!(await isFolder(dir))) throw new DataError(400, "not a folder");
          const entries = (await readdir(dir, { withFileTypes: true }))
            .filter((e) => e.isFile() && usableName(e.name, config))
            .sort((a, b) => a.name.localeCompare(b.name));
          const files = [];
          for (const e of entries.slice(0, config.maxFiles)) {
            const full = join(dir, e.name);
            const st = await stat(full);
            files.push({ name: e.name, path: full, ext: extname(e.name).toLowerCase(), size: st.size, modified: st.mtime.toISOString(), tooBig: st.size > capFor(e.name, config) });
          }
          return dataJson(res, 200, { path: dir, files, truncated: entries.length > config.maxFiles, maxFiles: config.maxFiles });
        }
        if (name === "file") {
          const file = await insideRoots(p, config);
          const st = await stat(file);
          if (!st.isFile()) throw new DataError(400, "not a file");
          if (!usableName(file, config)) throw new DataError(403, `not an allowed file type (${config.extensions.join(", ")}) or excluded`);
          if (st.size > capFor(file, config)) throw new DataError(413, `larger than the ${extname(file)} limit (${capFor(file, config)} bytes)`);
          res.writeHead(200, { "content-type": extname(file).toLowerCase() === ".pdf" ? "application/pdf" : "text/plain; charset=utf-8", ...dataHeaders });
          res.end(await readFile(file));
          return;
        }
        return dataJson(res, 404, { error: "unknown data route" });
      } catch (e) {
        if (e instanceof DataError) return dataJson(res, e.status, { error: e.message });
        throw e;
      }
    }
    if (api === "leaving") {
      json(res, 200, await (await fetch(SPY)).json());
      return;
    }
    if (api === "ledger") {
      execFile("docker", ["exec", "ca-gateway", "sh", "-c", "tail -n 6 /data/ledger/*.jsonl"], (err, out) => {
        const lines = err ? [] : out.trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } });
        json(res, 200, { lines });
      });
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 502, { error: (e as Error).message });
  }
}).listen(PORT, "127.0.0.1", async () => {
  console.log(`[test-console] http://127.0.0.1:${PORT}  default model: ${DEFAULT_MODEL}`);
  const { config, error } = readDataConfig();
  if (!config) console.log(`[test-console] ${error}`);
  else console.log(`[test-console] data folders: ${config.allowedRoots.join(", ")}; default ${config.defaultFolder}${(await isFolder(config.defaultFolder)) ? "" : "  (NOT FOUND: create it)"}`);
});
