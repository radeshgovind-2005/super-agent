/**
 * Reads the machine part of a ticket's eval.md: the ```yaml block under "## Checks".
 * The rest of eval.md is prose for people and is ignored here.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { SaError, isErrno } from "./errors.js";
import { isRecord, oneOf, str, type Problems } from "./validate.js";

export const CHECK_TYPES = ["command", "browser", "rubric"] as const;
export const DEFAULT_TIMEOUT_SEC = 300;

export interface CommandCheck {
  id: string;
  type: "command";
  run: string;
  expectExit: number;
  timeoutSec: number;
  /** Test files this check relies on; a worker may not edit them. Relative to the worktree. */
  files?: string[];
}

/** Browser and rubric checks need an agent or a person; sa reports them as skipped. */
export interface ManualCheck {
  id: string;
  type: "browser" | "rubric";
  run: string;
  expect?: string;
  evidence?: string;
}

export type Check = CommandCheck | ManualCheck;

function checksBlock(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const heading = lines.findIndex((l) => /^##\s+Checks\b/.test(l));
  if (heading === -1) throw new SaError("EVAL_FILE", 'no "## Checks" section');

  for (let i = heading + 1; i < lines.length && !/^##?\s/.test(lines[i]!); i++) {
    if (!/^```ya?ml\s*$/.test(lines[i]!)) continue;
    const end = lines.findIndex((l, j) => j > i && /^```\s*$/.test(l));
    if (end === -1) break;
    return lines.slice(i + 1, end).join("\n");
  }
  return undefined;
}

/** Parse eval.md text. Throws EVAL_FILE listing every problem, prefixed with `label`. */
export function parseEvalMarkdown(text: string, label = "eval.md"): Check[] {
  const fail = (msg: string): never => {
    throw new SaError("EVAL_FILE", `${label}: ${msg}`);
  };

  let block: string | undefined;
  try {
    block = checksBlock(text);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (block === undefined) return fail('no ```yaml block under "## Checks"');

  let raw: unknown;
  try {
    raw = parseYaml(block);
  } catch (e) {
    return fail(`checks block is not valid YAML (${(e as Error).message.split("\n")[0]})`);
  }
  if (!Array.isArray(raw) || raw.length === 0) return fail("checks block must be a list with at least one check");

  const p: Problems = [];
  const seen = new Set<string>();
  const checks = raw.map((item, i) => parseCheck(p, item, i, seen));
  if (p.length) fail(p.join("; "));
  return checks;
}

function parseCheck(p: Problems, item: unknown, index: number, seen: Set<string>): Check {
  if (!isRecord(item)) {
    p.push(`check ${index + 1}: expected a mapping`);
    item = {};
  }
  const r = item as Record<string, unknown>;
  const id = str(p, `check ${index + 1}: id`, r.id);
  const at = `check ${id || index + 1}`;
  if (id && seen.has(id)) p.push(`duplicate check id ${id}`);
  seen.add(id);

  const type = oneOf(p, `${at}: type`, r.type, CHECK_TYPES);
  const run = str(p, `${at}: run`, r.run);

  if (type === "command") {
    let expectExit = 0;
    if (r.expect !== undefined) {
      const m = typeof r.expect === "string" ? /^exit (\d+)$/.exec(r.expect.trim()) : null;
      if (m) expectExit = Number(m[1]);
      else p.push(`${at}: expect: a command check expects "exit <code>"`);
    }
    let timeoutSec = DEFAULT_TIMEOUT_SEC;
    if (r.timeout !== undefined) {
      if (typeof r.timeout === "number" && r.timeout > 0) timeoutSec = r.timeout;
      else p.push(`${at}: timeout: expected seconds > 0`);
    }
    const check: CommandCheck = { id, type, run, expectExit, timeoutSec };
    if (r.files !== undefined) {
      if (Array.isArray(r.files) && r.files.length && r.files.every((f) => typeof f === "string" && f.length)) {
        check.files = [...(r.files as string[])];
      } else {
        p.push(`${at}: files: expected a list of paths`);
      }
    }
    return check;
  }

  const check: ManualCheck = { id, type, run };
  if (r.expect !== undefined) check.expect = String(r.expect);
  if (r.evidence !== undefined) check.evidence = String(r.evidence);
  return check;
}

/** The ticket's folder: tickets/<id>-<slug> or tickets/<id>. */
export async function findTicketDir(saDir: string, id: string): Promise<string> {
  const root = join(saDir, "tickets");
  let names: string[] = [];
  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && (d.name === id || d.name.startsWith(`${id}-`)))
      .map((d) => d.name)
      .sort();
  } catch (e) {
    if (!isErrno(e, "ENOENT")) throw e;
  }
  if (names.length === 0) throw new SaError("EVAL_FILE", `No ticket folder for ${id} in ${root}`);
  if (names.length > 1) {
    throw new SaError("EVAL_FILE", `${names.length} folders match ticket ${id}: ${names.join(", ")}`);
  }
  return join(root, names[0]!);
}

/** Load and parse a ticket's eval.md from the given .superagent folder (always the main checkout's). */
export async function loadEvalChecks(saDir: string, id: string): Promise<Check[]> {
  const file = join(await findTicketDir(saDir, id), "eval.md");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if (isErrno(e, "ENOENT")) throw new SaError("EVAL_FILE", `No eval.md for ticket ${id} at ${file}`);
    throw e;
  }
  return parseEvalMarkdown(text, relative(saDir, file));
}
