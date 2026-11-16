/**
 * The ticket state machine as pure functions: each takes a State and returns a new
 * one, or throws SaError. They never mutate their input and never touch the disk.
 *
 *   draft --markReady--> ready --claim--> in_progress --submit--> review --markDone--> done
 *                          ^                 |    |
 *                          +---- retry ------+    +--block--> blocked --markReady--> ready
 *   ready --block--> blocked
 */
import { SaError } from "./errors.js";
import type { EvalResult, State, Ticket, TicketMode, TicketStatus } from "./types.js";

export interface NewTicket {
  title: string;
  mode: TicketMode;
  dependsOn: string[];
}

/** Register a new draft ticket. Dependencies must already exist, so cycles cannot form. */
export function addTicket(state: State, id: string, input: NewTicket): State {
  if (state.tickets[id]) throw new SaError("DUPLICATE_TICKET", `Ticket ${id} already exists`);
  for (const dep of input.dependsOn) {
    if (!state.tickets[dep]) throw new SaError("UNKNOWN_TICKET", `Unknown ticket ${dep}`);
  }
  return {
    ...state,
    tickets: {
      ...state.tickets,
      [id]: {
        title: input.title,
        status: "draft",
        mode: input.mode,
        dependsOn: [...input.dependsOn],
        branch: null,
        worktree: null,
        owner: null,
        attempts: 0,
        lastEval: null,
        pr: null,
      },
    },
  };
}

function get(state: State, id: string): Ticket {
  const t = state.tickets[id];
  if (!t) throw new SaError("UNKNOWN_TICKET", `Unknown ticket ${id}`);
  return t;
}

function expectStatus(id: string, t: Ticket, action: string, allowed: TicketStatus[]): void {
  if (!allowed.includes(t.status)) {
    throw new SaError(
      "ILLEGAL_TRANSITION",
      `Cannot ${action} ticket ${id}: it is ${t.status} (needs ${allowed.join(" or ")})`,
    );
  }
}

function put(state: State, id: string, ticket: Ticket): State {
  return { ...state, tickets: { ...state.tickets, [id]: ticket } };
}

/** Dependencies count as met once they are in review or done. */
export function unmetDeps(state: State, id: string): string[] {
  return get(state, id).dependsOn.filter((dep) => {
    const s = state.tickets[dep]?.status;
    return s !== "review" && s !== "done";
  });
}

export function markReady(state: State, id: string): State {
  const t = get(state, id);
  expectStatus(id, t, "mark ready", ["draft", "blocked"]);
  return put(state, id, { ...t, status: "ready" });
}

export interface ClaimInput {
  agent: string;
  branch: string;
  worktree: string;
}

export function claim(state: State, id: string, input: ClaimInput): State {
  const t = get(state, id);
  expectStatus(id, t, "claim", ["ready"]);

  const unmet = unmetDeps(state, id);
  if (unmet.length) {
    throw new SaError("DEPS_UNMET", `Cannot claim ticket ${id}: waiting on ${unmet.join(", ")}`);
  }

  const running = Object.values(state.tickets).filter((x) => x.status === "in_progress").length;
  if (running >= state.run.maxWorkers) {
    throw new SaError(
      "MAX_WORKERS",
      `Cannot claim ticket ${id}: ${running} of ${state.run.maxWorkers} workers are busy`,
    );
  }

  return put(state, id, {
    ...t,
    status: "in_progress",
    owner: input.agent,
    branch: input.branch,
    worktree: input.worktree,
    attempts: t.attempts + 1,
  });
}

export function recordEval(state: State, id: string, result: EvalResult): State {
  const t = get(state, id);
  expectStatus(id, t, "record an eval for", ["in_progress"]);
  return put(state, id, { ...t, lastEval: { ...result, failed: [...result.failed] } });
}

export interface SubmitInput {
  pr: string;
  /** The worktree's current HEAD; must equal the commit the passing eval ran on. */
  headCommit: string;
}

export function submit(state: State, id: string, input: SubmitInput): State {
  const t = get(state, id);
  expectStatus(id, t, "submit", ["in_progress"]);

  if (t.lastEval?.result !== "pass") {
    throw new SaError("EVAL_NOT_PASSED", `Cannot submit ticket ${id}: its last eval has not passed`);
  }
  if (t.lastEval.commit !== input.headCommit) {
    throw new SaError(
      "STALE_EVAL",
      `Cannot submit ticket ${id}: the passing eval ran on ${t.lastEval.commit ?? "an unknown commit"}, but HEAD is ${input.headCommit}. Run the eval again.`,
    );
  }
  return put(state, id, { ...t, status: "review", pr: input.pr, owner: null });
}

/** Give an in-progress ticket back so it can be claimed again. Keeps branch and worktree. */
export function retry(state: State, id: string): State {
  const t = get(state, id);
  expectStatus(id, t, "retry", ["in_progress"]);
  return put(state, id, { ...t, status: "ready", owner: null });
}

export function block(state: State, id: string): State {
  const t = get(state, id);
  expectStatus(id, t, "block", ["ready", "in_progress"]);
  return put(state, id, { ...t, status: "blocked", owner: null });
}

/** The PR was merged by a human. */
export function markDone(state: State, id: string): State {
  const t = get(state, id);
  expectStatus(id, t, "mark done", ["review"]);
  return put(state, id, { ...t, status: "done" });
}
