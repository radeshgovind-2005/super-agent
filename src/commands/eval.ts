import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runShell } from "../adapters/exec.js";
import { headCommit, isClean } from "../adapters/git.js";
import { SaError, UsageError } from "../core/errors.js";
import { loadEvalChecks, type Check } from "../core/evalfile.js";
import { appendEvent } from "../core/events.js";
import { findSuperagentDir } from "../core/paths.js";
import { loadState, updateState } from "../core/state.js";
import { recordEval } from "../core/transitions.js";
import type { EvalResult } from "../core/types.js";
import { EXIT } from "../io.js";
import type { Command } from "./types.js";

const OUTPUT_LINES_SHOWN = 20;

export type CheckReport =
  | {
      id: string;
      type: "command";
      status: "pass" | "fail";
      exitCode: number | null;
      expectExit: number;
      timedOut: boolean;
      timeoutSec: number;
      durationMs: number;
      run: string;
      output: string;
    }
  | { id: string; type: "browser" | "rubric"; status: "skipped" };

export interface EvalReport {
  id: string;
  result: "pass" | "fail";
  failed: string[];
  skipped: string[];
  /** The commit the eval is tied to; null if the tree was dirty or HEAD moved. */
  commit: string | null;
  warnings: string[];
  checks: CheckReport[];
}

async function runChecks(checks: Check[], cwd: string, id: string): Promise<CheckReport[]> {
  const reports: CheckReport[] = [];
  for (const c of checks) {
    if (c.type !== "command") {
      reports.push({ id: c.id, type: c.type, status: "skipped" });
      continue;
    }
    const r = await runShell(c.run, { cwd, timeoutMs: c.timeoutSec * 1000, env: { SA_TICKET: id } });
    reports.push({
      id: c.id,
      type: "command",
      status: !r.timedOut && r.exitCode === c.expectExit ? "pass" : "fail",
      exitCode: r.exitCode,
      expectExit: c.expectExit,
      timedOut: r.timedOut,
      timeoutSec: c.timeoutSec,
      durationMs: r.durationMs,
      run: c.run,
      output: r.output,
    });
  }
  return reports;
}

export function renderEval(report: EvalReport, checks: Check[]): string {
  const commands = report.checks.filter((c) => c.type === "command");
  const skip = report.skipped.length ? `, ${report.skipped.length} skipped` : "";
  const summary =
    report.result === "pass"
      ? `${commands.length} of ${commands.length} command checks passed${skip}`
      : `${report.failed.length} of ${commands.length} command checks failed${skip}`;

  const lines = [`Eval ${report.id}: ${report.result.toUpperCase()} (${summary})`];
  for (const c of report.checks) {
    if (c.type !== "command") {
      const run = checks.find((x) => x.id === c.id)?.run ?? "";
      lines.push(`  SKIP  ${c.id}  ${c.type} check, not run by sa: ${run}`);
      continue;
    }
    const secs = `(${(c.durationMs / 1000).toFixed(1)}s)`;
    if (c.status === "pass") {
      lines.push(`  PASS  ${c.id}  ${c.run} ${secs}`);
      continue;
    }
    const why = c.timedOut ? `timed out after ${c.timeoutSec}s` : `exit ${c.exitCode}, expected exit ${c.expectExit}`;
    lines.push(`  FAIL  ${c.id}  ${why} ${secs}`, `        $ ${c.run}`);
    const tail = c.output.trimEnd().split("\n").slice(-OUTPUT_LINES_SHOWN);
    if (tail.length && tail[0] !== "") lines.push(...tail.map((l) => `        | ${l}`));
  }
  for (const w of report.warnings) lines.push(`Warning: ${w}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Run a ticket's command checks in its worktree and record the result (lastEval + eval event).
 * Shared by `sa eval` and the Stop hook. Throws SaError if the eval cannot run.
 */
export async function runTicketEval(
  saDir: string,
  id: string,
  now: Date,
): Promise<{ report: EvalReport; checks: Check[] }> {
  const state = await loadState(saDir);
  const ticket = state.tickets[id];
  if (!ticket) throw new SaError("UNKNOWN_TICKET", `Unknown ticket ${id}`);

  // Refuse before running anything if the result could not be recorded.
  const at = now.toISOString();
  recordEval(state, id, { result: "fail", at, failed: [] });

  const checks = await loadEvalChecks(saDir, id);
  if (!checks.some((c) => c.type === "command")) {
    throw new SaError("NO_COMMAND_CHECK", `The eval for ticket ${id} has no command check, so sa cannot run it`);
  }

  const worktree = resolve(dirname(saDir), ticket.worktree!);
  if (!existsSync(worktree)) throw new SaError("GIT_FAILED", `Worktree for ticket ${id} not found at ${worktree}`);

  const warnings: string[] = [];
  const headBefore = headCommit(worktree);
  const clean = isClean(worktree);
  const reports = await runChecks(checks, worktree, id);
  const headAfter = headCommit(worktree);

  if (!clean) {
    warnings.push(
      "The worktree has uncommitted changes, so this eval is not tied to a commit. Commit, then run sa eval again before sa submit.",
    );
  } else if (headBefore !== headAfter) {
    warnings.push("HEAD moved while the checks ran, so this eval is not tied to a commit. Run sa eval again.");
  }
  const commit = clean && headBefore === headAfter ? headBefore : null;

  const failed = reports.filter((r) => r.status === "fail").map((r) => r.id);
  const skipped = reports.filter((r) => r.status === "skipped").map((r) => r.id);
  const result = failed.length ? "fail" : "pass";

  const evalResult: EvalResult = { result, at, failed, ...(commit ? { commit } : {}) };
  await updateState(saDir, (s) => recordEval(s, id, evalResult));
  await appendEvent(saDir, {
    t: at,
    agent: ticket.owner ?? "sa",
    ticket: id,
    type: "eval",
    result,
    failed,
    skipped,
    ...(commit ? { commit } : {}),
  });

  return { report: { id, result, failed, skipped, commit, warnings, checks: reports }, checks };
}

export const evalCmd: Command = {
  name: "eval",
  summary: "Run a ticket's command checks in its worktree and record pass/fail",
  usage: `Usage: sa eval <id> [--json]

Runs the command checks from the ticket's eval.md (read from the main checkout)
inside the ticket's worktree. Browser and rubric checks are reported as skipped.
Exits 0 if every command check passed, 1 otherwise.
`,
  async main(argv, io, ctx) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { json: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    const [id, ...extra] = positionals;
    if (!id || extra.length) throw new UsageError("Expected exactly one ticket <id>");

    const { report, checks } = await runTicketEval(findSuperagentDir(ctx.cwd), id, ctx.now());
    io.stdout(values.json ? `${JSON.stringify(report, null, 2)}\n` : renderEval(report, checks));
    return report.result === "pass" ? EXIT.ok : EXIT.refused;
  },
};
