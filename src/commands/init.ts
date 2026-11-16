import { parseArgs } from "node:util";
import { UsageError } from "../core/errors.js";
import { findSuperagentDir } from "../core/paths.js";
import { initState } from "../core/state.js";
import { EXIT } from "../io.js";
import type { Command } from "./types.js";

function wholeNumber(flag: string, value: string | undefined, fallback: number, min: number, what: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min) throw new UsageError(`${flag} must be ${what}`);
  return Number(value);
}

export const init: Command = {
  name: "init",
  summary: "Create .superagent/ with an empty board",
  usage: `Usage: sa init [--max-workers <n>] [--budget <tokens>]

Creates .superagent/ in the main checkout. Defaults: 2 workers, 2,000,000 tokens.
`,
  async main(argv, io, ctx) {
    const { values } = parseArgs({
      args: argv,
      options: { "max-workers": { type: "string" }, budget: { type: "string" } },
      strict: true,
    });
    const maxWorkers = wholeNumber("--max-workers", values["max-workers"], 2, 1, "a whole number >= 1");
    const budgetTokens = wholeNumber("--budget", values.budget, 2_000_000, 0, "a whole number of tokens >= 0");

    const saDir = findSuperagentDir(ctx.cwd);
    const id = `${ctx.now().toISOString().slice(0, 10)}-a`;
    await initState(saDir, { id, budgetTokens, maxWorkers });
    io.stdout(`Initialised ${saDir}\n`);
    return EXIT.ok;
  },
};
