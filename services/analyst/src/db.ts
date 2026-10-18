/**
 * DuckDB, in memory, one instance per analysis. Files are loaded as text (all_varchar) so a stray value never breaks
 * type detection; role columns are parsed with TRY_ functions instead. As soon as the files are loaded, file access
 * is switched off and the configuration locked, so nothing after loading can read or write any file.
 */
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export type Db = { conn: DuckDBConnection; close: () => void };

export async function openDb(): Promise<Db> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  return { conn, close: () => { try { conn.closeSync(); } catch { /* already closed */ } try { instance.closeSync(); } catch { /* already closed */ } } };
}

export const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;
export const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`;

export async function rows<T = Record<string, unknown>>(db: Db, sql: string): Promise<T[]> {
  return (await db.conn.runAndReadAll(sql)).getRowObjectsJson() as T[];
}

/** Loads one CSV/TSV as text into a table with __row = its data line number (1 = first row after the header). The path is a real path already confined to the allowed roots. */
export async function loadText(db: Db, table: string, path: string): Promise<void> {
  const delim = /\.tsv$/i.test(path) ? ", delim='\\t'" : "";
  await db.conn.run(`CREATE TABLE ${ident(table)} AS SELECT CAST(row_number() OVER () AS INTEGER) AS __row, * FROM read_csv(${literal(path)}, header=true, all_varchar=true${delim})`);
}

/** After loading: no more file reads or writes from SQL, and that cannot be switched back on. */
export async function lockFiles(db: Db): Promise<void> {
  await db.conn.run("SET enable_external_access = false");
  await db.conn.run("SET lock_configuration = true");
}

/** SQL turning a text column into a DATE. A recipe can fix the format (strptime syntax); otherwise ISO, US (m/d/Y) and then day-first are tried, in that order. */
export function dateExpr(col: string, format: string | null | undefined): string {
  const c = `trim(${ident(col)})`;
  if (format) return `CAST(try_strptime(${c}, ${literal(format)}) AS DATE)`;
  const formats = ["%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y", "%Y/%m/%d", "%d-%b-%Y", "%b %d %Y", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y %H:%M"];
  return `CAST(coalesce(${formats.map((f) => `try_strptime(${c}, ${literal(f)})`).join(", ")}) AS DATE)`;
}

/**
 * SQL turning a text column into a number. Only currency symbols, spaces, signs, parentheses, digits and separators
 * are accepted (so "CLM-100000" or "D0120" are not numbers); (123.45) and a trailing minus mean negative.
 */
export function amountExpr(col: string): string {
  const c = `trim(${ident(col)})`;
  const cleaned = `regexp_replace(${c}, '[^0-9.()\\-]', '', 'g')`;
  return `CASE WHEN ${c} IS NULL OR ${c} = '' THEN NULL
    WHEN NOT regexp_full_match(${c}, '[\\s$€£¥₹+\\-()0-9.,]+') OR NOT regexp_matches(${c}, '[0-9]') THEN NULL
    WHEN ${cleaned} LIKE '(%)' THEN -TRY_CAST(regexp_replace(${cleaned}, '[()]', '', 'g') AS DOUBLE)
    WHEN ${cleaned} LIKE '%-' THEN -TRY_CAST(rtrim(${cleaned}, '-') AS DOUBLE)
    ELSE TRY_CAST(${cleaned} AS DOUBLE) END`;
}
