import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createPr, findOpenPr } from "../adapters/gh.js";
import { currentBranch, headCommit, pushCommit } from "../adapters/git.js";
import { SaError, UsageError } from "../core/errors.js";
import { findTicketDir } from "../core/evalfile.js";
import { appendEvent } from "../core/events.js";
import { findSuperagentDir } from "../core/paths.js";
import { loadState, updateState } from "../core/state.js";
import { submit as submitTransition } from "../core/transitions.js";
import type { Ticket } from "../core/types.js";
import { EXIT } from "../io.js";
import type { Command } from "./types.js";

const REMOTE = "origin";
const BRANCH_PREFIX = "sa/";

/** Default PR title: a Conventional Commit with the ticket id as scope. */
export function defaultTitle(id: string, title: string): string {
  return `feat(${id}): ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

async function prBody(saDir: string, id: string, t: Ticket, commit: string): Promise<string> {
  const lines = [`Ticket ${id}: ${t.title}`, ""];
  try {
    const dir = relative(dirname(saDir), await findTicketDir(saDir, id));
    lines.push(`Spec: ${join(dir, "spec.md")}`, `Eval: ${join(dir, "eval.md")}`);
  } catch {
    // no ticket folder: leave the links out
  }
  lines.push(
    `Eval: PASS on ${commit.slice(0, 7)} at ${t.lastEval?.at ?? "?"}`,
    "",
    `Opened by \`sa submit\` for ${t.owner ?? "an agent"}. A human reviews and merges.`,
  );
  return lines.join("\n");
}

export const submit: Command = {
  name: "submit",
  summary: "Push a ticket's evaluated commit, open its PR, and move it to review",
  usage: `Usage: sa submit <id> [--base <branch>] [--title <text>] [--json]

Needs a passing eval on the worktree's current HEAD. Pushes exactly that commit
to origin/<ticket branch> (only sa/ branches), opens a PR (or reuses an open
one), and moves the ticket to review. --base defaults to main.
`,
  async main(argv, io, ctx) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { base: { type: "string" }, title: { type: "string" }, json: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    const [id, ...extra] = positionals;
    if (!id || extra.length) throw new UsageError("Expected exactly one ticket <id>");

    const saDir = findSuperagentDir(ctx.cwd);
    const state = await loadState(saDir);
    const t = state.tickets[id];
    if (!t) throw new SaError("UNKNOWN_TICKET", `Unknown ticket ${id}`);
    if (t.status !== "in_progress") submitTransition(state, id, { pr: "", headCommit: "" }); // throws the usual message

    // Every check comes before anything leaves this machine.
    const branch = t.branch!;
    if (!branch.startsWith(BRANCH_PREFIX)) {
      throw new SaError("PROTECTED_BRANCH", `Cannot submit ticket ${id}: refusing to push ${branch}: sa only pushes ${BRANCH_PREFIX} branches`);
    }
    const worktree = resolve(dirname(saDir), t.worktree!);
    const onBranch = currentBranch(worktree);
    if (onBranch !== branch) {
      throw new SaError(
        "WRONG_BRANCH",
        `Cannot submit: the worktree for ticket ${id} is on ${onBranch || "a detached HEAD"}, expected ${branch}`,
      );
    }
    const commit = headCommit(worktree);
    submitTransition(state, id, { pr: "pending", headCommit: commit }); // eval passed, on this exact commit

    pushCommit(worktree, REMOTE, commit, branch);

    const gh = { cwd: worktree, env: ctx.env };
    let pr = findOpenPr(branch, gh);
    const created = pr === null;
    pr ??= createPr(
      {
        base: values.base ?? "main",
        head: branch,
        title: values.title ?? defaultTitle(id, t.title),
        body: await prBody(saDir, id, t, commit),
      },
      gh,
    );

    await updateState(saDir, (s) => submitTransition(s, id, { pr: pr!, headCommit: commit }));
    await appendEvent(saDir, {
      t: ctx.now().toISOString(),
      agent: t.owner!,
      ticket: id,
      type: "pr_opened",
      pr,
      branch,
      commit,
    });

    io.stdout(
      values.json
        ? `${JSON.stringify({ id, pr, branch, commit, created }, null, 2)}\n`
        : `Submitted ${id}: ${pr}\n`,
    );
    return EXIT.ok;
  },
};
