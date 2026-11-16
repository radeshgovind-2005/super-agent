import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderBoard } from "./board.js";
import { SaError, isErrno } from "./errors.js";
import { writeFileAtomic } from "./fsutil.js";
import { withLock, type LockOptions } from "./lock.js";
import { BOARD_FILE, LOCK_FILE, STATE_FILE } from "./paths.js";
import { TICKET_ID, TICKET_MODES, TICKET_STATUSES, type EvalResult, type State, type Ticket } from "./types.js";
import { int, isRecord, isoTime, oneOf, str, strArray, strOrNull, type Problems } from "./validate.js";

/** Validate unknown JSON as a State. Throws INVALID_STATE listing every problem. Returns a fresh copy. */
export function parseState(raw: unknown): State {
  const p: Problems = [];
  if (!isRecord(raw)) throw new SaError("INVALID_STATE", "Invalid state:\n  state: expected an object");

  if (raw.version !== 1) p.push("version: expected 1");

  const run = isRecord(raw.run) ? raw.run : (p.push("run: expected an object"), {});
  const parsedRun = {
    id: str(p, "run.id", run.id),
    budgetTokens: int(p, "run.budgetTokens", run.budgetTokens, 0),
    maxWorkers: int(p, "run.maxWorkers", run.maxWorkers, 1),
  };

  const rawTickets = isRecord(raw.tickets) ? raw.tickets : (p.push("tickets: expected an object"), {});
  const tickets: Record<string, Ticket> = {};
  for (const [id, t] of Object.entries(rawTickets)) {
    if (!TICKET_ID.test(id)) p.push(`tickets.${id}: ticket id must be 3+ digits`);
    tickets[id] = parseTicket(p, `tickets.${id}`, t);
  }

  for (const [id, t] of Object.entries(tickets)) {
    for (const dep of t.dependsOn) {
      if (dep === id) p.push(`tickets.${id}.dependsOn: ticket depends on itself`);
      else if (!(dep in tickets)) p.push(`tickets.${id}.dependsOn: unknown ticket ${dep}`);
    }
  }

  if (p.length) throw new SaError("INVALID_STATE", `Invalid state:\n  ${p.join("\n  ")}`);
  return { version: 1, run: parsedRun, tickets };
}

function parseTicket(p: Problems, path: string, raw: unknown): Ticket {
  if (!isRecord(raw)) {
    p.push(`${path}: expected an object`);
    raw = {};
  }
  const r = raw as Record<string, unknown>;
  const t: Ticket = {
    title: str(p, `${path}.title`, r.title),
    status: oneOf(p, `${path}.status`, r.status, TICKET_STATUSES),
    mode: oneOf(p, `${path}.mode`, r.mode, TICKET_MODES),
    dependsOn: strArray(p, `${path}.dependsOn`, r.dependsOn),
    branch: strOrNull(p, `${path}.branch`, r.branch),
    worktree: strOrNull(p, `${path}.worktree`, r.worktree),
    owner: strOrNull(p, `${path}.owner`, r.owner),
    attempts: int(p, `${path}.attempts`, r.attempts, 0),
    lastEval: r.lastEval === null ? null : parseEval(p, `${path}.lastEval`, r.lastEval),
    pr: strOrNull(p, `${path}.pr`, r.pr),
  };

  // Fields a status cannot do without.
  const required: Partial<Record<Ticket["status"], (keyof Ticket)[]>> = {
    in_progress: ["owner", "branch", "worktree"],
    review: ["branch", "pr"],
  };
  for (const field of required[t.status] ?? []) {
    if (t[field] === null) p.push(`${path}.${field}: required while ${t.status}`);
  }
  return t;
}

function parseEval(p: Problems, path: string, raw: unknown): EvalResult | null {
  if (!isRecord(raw)) {
    p.push(`${path}: expected an object or null`);
    return null;
  }
  const e: EvalResult = {
    result: oneOf(p, `${path}.result`, raw.result, ["pass", "fail"] as const),
    at: isoTime(p, `${path}.at`, raw.at),
    failed: strArray(p, `${path}.failed`, raw.failed),
  };
  if (raw.commit !== undefined) e.commit = str(p, `${path}.commit`, raw.commit);
  return e;
}

const notInitialized = (saDir: string) =>
  new SaError("NOT_INITIALIZED", `No state at ${join(saDir, STATE_FILE)}. Run /superagent init first.`);

export async function loadState(saDir: string): Promise<State> {
  let text: string;
  try {
    text = await readFile(join(saDir, STATE_FILE), "utf8");
  } catch (e) {
    if (isErrno(e, "ENOENT")) throw notInitialized(saDir);
    throw e;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SaError("INVALID_STATE", `Invalid state: ${STATE_FILE} is not valid JSON (${(e as Error).message})`);
  }
  return parseState(raw);
}

/**
 * Validate, regenerate board.md, then atomically write state.json. Callers should hold
 * the lock (use updateState). state.json is written LAST, so if this throws, the truth
 * is unchanged and callers can safely undo their side effects.
 */
export async function saveState(saDir: string, state: State): Promise<void> {
  const valid = parseState(state);
  const board = join(saDir, BOARD_FILE);
  await mkdir(dirname(board), { recursive: true });
  await writeFileAtomic(board, renderBoard(valid));
  await writeFileAtomic(join(saDir, STATE_FILE), `${JSON.stringify(valid, null, 2)}\n`);
}

/** Create .superagent/ with an empty state. Refuses if state.json already exists. */
export async function initState(saDir: string, run: State["run"]): Promise<State> {
  await mkdir(saDir, { recursive: true });
  return withLock(join(saDir, LOCK_FILE), async () => {
    if (existsSync(join(saDir, STATE_FILE))) {
      throw new SaError("ALREADY_INITIALIZED", `${saDir} is already initialised`);
    }
    const state: State = { version: 1, run, tickets: {} };
    await saveState(saDir, state);
    return state;
  });
}

/**
 * The one way to change state: lock, load, apply `change`, save, unlock.
 * If `change` throws (e.g. an illegal transition), nothing is written. `change` may be
 * async, e.g. to create a git worktree while the lock is held.
 */
export async function updateState(
  saDir: string,
  change: (state: State) => State | Promise<State>,
  lock: LockOptions = {},
): Promise<State> {
  // Without .superagent/ the lock file cannot be created; say what is wrong instead.
  if (!existsSync(saDir)) throw notInitialized(saDir);
  return withLock(
    join(saDir, LOCK_FILE),
    async () => {
      const next = await change(await loadState(saDir));
      await saveState(saDir, next);
      return next;
    },
    lock,
  );
}
