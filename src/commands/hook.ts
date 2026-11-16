import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { currentBranch } from "../adapters/git.js";
import { UsageError } from "../core/errors.js";
import { loadEvalChecks } from "../core/evalfile.js";
import { decide, type GuardContext } from "../hooks/guard.js";
import { HookInputError, parseHookInput, type HookInput } from "../hooks/input.js";
import { DEFAULT_MAX_FAILS, stopHook } from "../hooks/stop.js";
import { findWorkerTicket } from "../hooks/worker.js";
import type { Io } from "../io.js";
import type { Command, Ctx } from "./types.js";

async function guardContext(cwd: string, ctx: Ctx): Promise<GuardContext> {
  let branch: string | null = null;
  try {
    branch = currentBranch(cwd) || null;
  } catch {
    // not a git repo
  }

  let worker: GuardContext["worker"] = null;
  try {
    const w = await findWorkerTicket(cwd, ctx.env);
    if (w && w.ticket.status === "in_progress") {
      let protectedFiles: string[] = [];
      try {
        protectedFiles = (await loadEvalChecks(w.saDir, w.id)).flatMap((c) =>
          c.type === "command" ? (c.files ?? []).map((f) => resolve(w.worktree, f)) : [],
        );
      } catch {
        // no readable eval.md: eval.md itself is still protected by path
      }
      worker = { id: w.id, worktree: w.worktree, protectedFiles };
    }
  } catch {
    // unreadable state: still apply the rules for everyone
  }
  return { cwd, branch, worker };
}

async function preToolUse(input: HookInput, io: Io, ctx: Ctx): Promise<number> {
  const cwd = input.cwd ?? ctx.cwd;
  const reason = decide({ toolName: input.toolName ?? "", toolInput: input.toolInput ?? {} }, await guardContext(cwd, ctx));
  if (!reason) return 0;
  io.stderr(`sa: blocked: ${reason}\n`);
  return 2;
}

export const hook: Command = {
  name: "hook",
  summary: "Claude Code hook entry points (stop, pre-tool-use); reads hook JSON on stdin",
  usage: `Usage: sa hook stop [--max-fails <n>]
       sa hook pre-tool-use

stop          For Stop and SubagentStop. Runs the worker's eval; exits 2 (keep
              working) while it fails or the work is uncommitted. After <n>
              (default ${DEFAULT_MAX_FAILS}) such evals in a row, blocks the ticket and exits 0.
pre-tool-use  For PreToolUse. Exits 2 to block secrets, pushes to main, PR
              merges, writes to sa state, and (for workers) edits to eval files.
`,
  async main(argv, io, ctx) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { "max-fails": { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    const [kind, ...extra] = positionals;
    if (extra.length || (kind !== "stop" && kind !== "pre-tool-use")) {
      throw new UsageError("Expected stop or pre-tool-use");
    }
    const maxFailsText = values["max-fails"] ?? String(DEFAULT_MAX_FAILS);
    if (!/^\d+$/.test(maxFailsText) || Number(maxFailsText) < 1) throw new UsageError("--max-fails must be >= 1");

    let input: HookInput;
    try {
      input = parseHookInput(await ctx.readStdin());
    } catch (e) {
      if (!(e instanceof HookInputError)) throw e;
      io.stderr(`sa: ${kind === "stop" ? "" : "blocked: "}${e.message}\n`);
      // A broken guard fails closed; a broken stop hook must not trap the session.
      return kind === "stop" ? 1 : 2;
    }

    return kind === "stop" ? stopHook(input, io, ctx, Number(maxFailsText)) : preToolUse(input, io, ctx);
  },
};
