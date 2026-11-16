import { realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { SaError } from "../core/errors.js";
import { findSuperagentDir } from "../core/paths.js";
import { loadState } from "../core/state.js";
import type { State, Ticket } from "../core/types.js";

export interface WorkerTicket {
  saDir: string;
  state: State;
  id: string;
  ticket: Ticket;
  /** Absolute, real path of the ticket's worktree. */
  worktree: string;
}

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/**
 * The ticket a session is working on: $SA_TICKET if set, else the ticket whose
 * worktree contains `cwd`. null outside an initialised sa project or a ticket worktree.
 */
export async function findWorkerTicket(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<WorkerTicket | null> {
  let saDir: string;
  let state: State;
  try {
    saDir = findSuperagentDir(cwd);
    state = await loadState(saDir);
  } catch (e) {
    if (e instanceof SaError && (e.code === "NOT_IN_REPO" || e.code === "NOT_INITIALIZED")) return null;
    throw e;
  }
  const root = dirname(saDir);
  const worktreeOf = (t: Ticket) => real(resolve(root, t.worktree!));

  const fromEnv = env.SA_TICKET;
  if (fromEnv && state.tickets[fromEnv]?.worktree) {
    const ticket = state.tickets[fromEnv]!;
    return { saDir, state, id: fromEnv, ticket, worktree: worktreeOf(ticket) };
  }

  const here = real(cwd);
  const matches = Object.entries(state.tickets)
    .filter(([, t]) => t.worktree)
    .filter(([, t]) => {
      const wt = worktreeOf(t);
      return here === wt || here.startsWith(wt + sep);
    })
    // A retried worktree may belong to several tickets' history; prefer the active one.
    .sort(([, a], [, b]) => Number(b.status === "in_progress") - Number(a.status === "in_progress"));
  const hit = matches[0];
  return hit ? { saDir, state, id: hit[0], ticket: hit[1], worktree: worktreeOf(hit[1]) } : null;
}
