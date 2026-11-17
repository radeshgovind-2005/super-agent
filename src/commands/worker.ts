import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { hasSaHooks, readClaudeSettings, saCommandFrom } from "../core/claudeSettings.js";
import { SaError, UsageError, isErrno } from "../core/errors.js";
import { findTicketDir } from "../core/evalfile.js";
import { appendEvent } from "../core/events.js";
import { findSuperagentDir } from "../core/paths.js";
import { loadState } from "../core/state.js";
import { EXIT } from "../io.js";
import { workerPrompt } from "../runner/claude/templates.js";
import type { Command } from "./types.js";

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

async function readOptional(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    if (isErrno(e, "ENOENT")) return "";
    throw e;
  }
}

/** Start `command args` detached in `cwd`, output appended to `log`. Resolves with the pid once it has spawned. */
function startDetached(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, log: string): Promise<number> {
  const fd = openSync(log, "a");
  return new Promise<number>((resolvePid, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
    child.once("error", (e) => reject(new SaError("CLAUDE_FAILED", `could not start ${command}: ${e.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolvePid(child.pid!);
    });
  }).finally(() => closeSync(fd));
}

export const worker: Command = {
  name: "worker",
  summary: "Start a headless Claude worker on a claimed ticket, in its worktree",
  usage: `Usage: sa worker start <id> [--model <model>] [--dry-run] [--json]

Starts \`claude -p --agent worker --permission-mode acceptEdits\` in the background
in the ticket's worktree, with SA_TICKET and SA_AGENT set and output in
.superagent/runs/<run>/<id>-attempt<n>.log. The ticket must be claimed, and its
worktree must contain sa's hooks (commit .claude/ before claiming).
--model defaults to sonnet. --dry-run prints the command instead of running it.
`,
  async main(argv, io, ctx) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { model: { type: "string" }, "dry-run": { type: "boolean" }, json: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    const [action, id, ...extra] = positionals;
    if (action !== "start" || !id || extra.length) throw new UsageError("Expected: start <id>");
    const model = values.model ?? "sonnet";

    const saDir = findSuperagentDir(ctx.cwd);
    const repoRoot = dirname(saDir);
    const state = await loadState(saDir);
    const t = state.tickets[id];
    if (!t) throw new SaError("UNKNOWN_TICKET", `Unknown ticket ${id}`);
    if (t.status !== "in_progress") {
      throw new SaError("ILLEGAL_TRANSITION", `Cannot start a worker for ticket ${id}: it is ${t.status} (claim it first)`);
    }
    const worktree = resolve(repoRoot, t.worktree!);
    const agent = t.owner!;

    const worktreeSettings = await readClaudeSettings(worktree);
    if (!hasSaHooks(worktreeSettings)) {
      throw new SaError(
        "SETUP_MISSING",
        `The worktree for ticket ${id} has no sa hooks in .claude/settings.json, so its eval gate would not run. ` +
          `Run sa init, commit .claude/settings.json on the base branch, then merge it into ${t.branch} (or block and re-claim the ticket).`,
      );
    }

    const dir = await findTicketDir(saDir, id);
    const prompt = workerPrompt({
      id,
      title: t.title,
      ticketDir: relative(repoRoot, dir),
      spec: await readOptional(join(dir, "spec.md")),
      eval: await readFile(join(dir, "eval.md"), "utf8"),
      saCommand: saCommandFrom(worktreeSettings) ?? "sa",
    });
    const args = ["-p", prompt, "--agent", "worker", "--model", model, "--permission-mode", "acceptEdits"];
    const shown = `cd ${quote(worktree)} && SA_TICKET=${id} SA_AGENT=${agent} claude ${args.map(quote).join(" ")}`
      .replace(`claude '-p'`, "claude -p");

    if (values["dry-run"]) {
      io.stdout(`${shown}\n`);
      return EXIT.ok;
    }

    const log = join(saDir, "runs", state.run.id, `${id}-attempt${t.attempts}.log`);
    await mkdir(dirname(log), { recursive: true });
    const env = { ...process.env, ...ctx.env, SA_TICKET: id, SA_AGENT: agent };
    const pid = await startDetached("claude", args, worktree, env, log);

    await appendEvent(saDir, { t: ctx.now().toISOString(), agent, ticket: id, type: "heartbeat", note: "worker started", pid, log });
    io.stdout(
      values.json
        ? `${JSON.stringify({ id, agent, pid, worktree, log, model }, null, 2)}\n`
        : `Started ${agent} on ${id} (pid ${pid})\nLog: ${log}\n`,
    );
    return EXIT.ok;
  },
};
