import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { addWorktree, isWorktreeRoot, removeWorktree, type CreatedWorktree } from "../adapters/git.js";
import { UsageError } from "../core/errors.js";
import { appendEvent } from "../core/events.js";
import { findSuperagentDir } from "../core/paths.js";
import { updateState } from "../core/state.js";
import { claim as claimTransition } from "../core/transitions.js";
import { EXIT } from "../io.js";
import { resolveAgent } from "./agent.js";
import type { Command } from "./types.js";

/** "sa/<id>-<slug>", slug from the title: ascii, lowercase, dashes, max 40 chars. */
export function branchName(id: string, title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `sa/${id}-${slug || "ticket"}`;
}

/** Worktrees live beside the repo, grouped by repo name so two repos never collide. */
export function defaultWorktree(repoRoot: string, id: string): string {
  return `../.sa-worktrees/${basename(repoRoot)}/${id}`;
}

export const claim: Command = {
  name: "claim",
  summary: "Claim a ready ticket for an agent and create its branch + worktree",
  usage: `Usage: sa claim <id> [--agent <name>] [--json]

Moves the ticket from ready to in_progress, creates branch sa/<id>-<slug> and a
worktree in ../.sa-worktrees/<repo>/<id>, and prints the worktree path.
--agent defaults to $SA_AGENT.
`,
  async main(argv, io, ctx) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { agent: { type: "string" }, json: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    const [id, ...extra] = positionals;
    if (!id || extra.length) throw new UsageError("Expected exactly one ticket <id>");
    const agent = resolveAgent(values.agent, ctx);

    const saDir = findSuperagentDir(ctx.cwd);
    const repoRoot = dirname(saDir);
    const made: { worktree?: CreatedWorktree } = {};

    let next;
    try {
      next = await updateState(saDir, (state) => {
        const current = state.tickets[id];
        const branch = current?.branch ?? branchName(id, current?.title ?? "");
        const worktree = current?.worktree ?? defaultWorktree(repoRoot, id);

        // Check every rule first; git is touched only if the claim is legal.
        const claimed = claimTransition(state, id, { agent, branch, worktree });

        const path = resolve(repoRoot, worktree);
        if (!isWorktreeRoot(path)) made.worktree = addWorktree(repoRoot, path, branch);
        return claimed;
      });
    } catch (e) {
      // The worktree exists but state was not saved: undo so the two stay in step.
      if (made.worktree) removeWorktree(repoRoot, made.worktree);
      throw e;
    }

    const t = next.tickets[id]!;
    const result = {
      id,
      agent,
      branch: t.branch!,
      worktree: resolve(repoRoot, t.worktree!),
      attempt: t.attempts,
    };
    await appendEvent(saDir, {
      t: ctx.now().toISOString(),
      agent,
      ticket: id,
      type: "claim",
      branch: result.branch,
      worktree: result.worktree,
      attempt: result.attempt,
    });

    io.stdout(
      values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Claimed ${id} for ${agent} on ${result.branch}\n${result.worktree}\n`,
    );
    return EXIT.ok;
  },
};
