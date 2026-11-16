import { parseArgs } from "node:util";
import { SaError, UsageError } from "../core/errors.js";
import { loadEvalChecks, type Check } from "../core/evalfile.js";
import { findSuperagentDir } from "../core/paths.js";
import { loadState, updateState } from "../core/state.js";
import { markReady } from "../core/transitions.js";
import { EXIT } from "../io.js";
import type { Command } from "./types.js";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const ready: Command = {
  name: "ready",
  summary: "Move a draft (or blocked) ticket to ready; needs a command check in eval.md",
  usage: `Usage: sa ready <id>

Moves the ticket from draft or blocked to ready. Refuses unless its eval.md
parses and has at least one check of type: command (one a machine can run).
`,
  async main(argv, io, ctx) {
    const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true, strict: true });
    const [id, ...extra] = positionals;
    if (!id || extra.length) throw new UsageError("Expected exactly one ticket <id>");

    const saDir = findSuperagentDir(ctx.cwd);
    markReady(await loadState(saDir), id); // status check first: unknown or wrong status

    let checks: Check[];
    try {
      checks = await loadEvalChecks(saDir, id);
    } catch (e) {
      if (e instanceof SaError) throw new SaError(e.code, `Cannot mark ${id} ready: ${e.message}`);
      throw e;
    }
    const commands = checks.filter((c) => c.type === "command").length;
    if (commands === 0) {
      throw new SaError(
        "NO_COMMAND_CHECK",
        `Cannot mark ${id} ready: its eval has no command check (sa needs at least one it can run)`,
      );
    }

    await updateState(saDir, (s) => markReady(s, id));
    const others = checks.length - commands;
    io.stdout(`Ready ${id} (${plural(commands, "command check")}${others ? `, ${others} other` : ""})\n`);
    return EXIT.ok;
  },
};
