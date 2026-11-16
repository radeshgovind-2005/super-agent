/**
 * Stop / SubagentStop hook: a worker may not stop while its eval fails.
 *
 * Exit 2 sends stderr back to the worker and keeps it working. To avoid an endless
 * loop, after `maxFails` evals in a row that cannot be submitted, the ticket is
 * blocked and the worker may stop. 5 stays below Claude Code's own cap of 8.
 */
import { renderEval, runTicketEval } from "../commands/eval.js";
import type { Ctx } from "../commands/types.js";
import { SaError } from "../core/errors.js";
import { appendEvent, readEvents } from "../core/events.js";
import { updateState } from "../core/state.js";
import { block } from "../core/transitions.js";
import type { SaEvent } from "../core/types.js";
import type { Io } from "../io.js";
import type { HookInput } from "./input.js";
import { findWorkerTicket } from "./worker.js";

export const DEFAULT_MAX_FAILS = 5;

/** Trailing eval events (since the ticket's last claim) that failed or are not tied to a commit. */
export function unsubmittableStreak(events: readonly SaEvent[], id: string): number {
  const mine = events.filter((e) => e.ticket === id);
  let lastClaim = -1;
  mine.forEach((e, i) => {
    if (e.type === "claim") lastClaim = i;
  });
  const evals = mine.slice(lastClaim + 1).filter((e) => e.type === "eval");
  let streak = 0;
  for (let i = evals.length - 1; i >= 0; i--) {
    const e = evals[i]!;
    if (e.result === "pass" && typeof e.commit === "string") break;
    streak++;
  }
  return streak;
}

export async function stopHook(input: HookInput, io: Io, ctx: Ctx, maxFails: number): Promise<number> {
  const worker = await findWorkerTicket(input.cwd ?? ctx.cwd, ctx.env);
  if (!worker || worker.ticket.status !== "in_progress") return 0;
  const { saDir, id } = worker;

  let result;
  try {
    result = await runTicketEval(saDir, id, ctx.now());
  } catch (e) {
    if (e instanceof SaError) {
      // Not the worker's fault and not fixable by it: do not trap it. Exit 1 shows the user a notice.
      io.stderr(`sa: the stop hook could not run the eval for ticket ${id}: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
  const { report, checks } = result;
  if (report.result === "pass" && report.commit) return 0;

  const streak = unsubmittableStreak(await readEvents(saDir), id);
  if (streak >= maxFails) {
    const reason = `eval failed ${streak} times in a row`;
    await updateState(saDir, (s) => block(s, id));
    await appendEvent(saDir, { t: ctx.now().toISOString(), agent: "sa", ticket: id, type: "blocked", reason });
    io.stderr(`sa: ticket ${id} blocked (${reason}); letting the worker stop.\n`);
    return 0;
  }

  const attempt = `attempt ${streak} of ${maxFails}`;
  const why =
    report.result === "fail"
      ? `sa: the eval for ticket ${id} failed (${attempt}). Fix the failing checks and commit; you cannot stop until they pass. Do not edit eval.md or the test files the eval uses.`
      : `sa: the checks for ticket ${id} pass, but your work is not committed, so it cannot be submitted (${attempt}). Commit your work, then stop again.`;
  io.stderr(`${renderEval(report, checks)}\n${why}\n`);
  return 2;
}
