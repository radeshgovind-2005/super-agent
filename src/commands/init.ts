import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { mergeSettings, readClaudeSettings, writeClaudeSettings } from "../core/claudeSettings.js";
import { UsageError } from "../core/errors.js";
import { updateGitignore } from "../core/gitignore.js";
import { findSuperagentDir } from "../core/paths.js";
import { initState, stateExists } from "../core/state.js";
import { EXIT } from "../io.js";
import type { Command } from "./types.js";

function wholeNumber(flag: string, value: string | undefined, fallback: number, min: number, what: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min) throw new UsageError(`${flag} must be ${what}`);
  return Number(value);
}

export const init: Command = {
  name: "init",
  summary: "Set up a repo: .superagent/, Claude hooks + deny rules, .gitignore",
  usage: `Usage: sa init [--max-workers <n>] [--budget <tokens>] [--sa-command <cmd>]

Safe to run again. In the main checkout it:
  - creates .superagent/ with an empty board (kept if it already exists)
  - adds sa's Stop, SubagentStop and PreToolUse hooks and deny rules to
    .claude/settings.json, keeping your other settings
  - adds sa's generated files to .gitignore
Defaults: 2 workers, 2,000,000 tokens. --sa-command is how hooks run sa
(default "sa", which must be on PATH), e.g. "node /path/to/dist/cli.js".
`,
  async main(argv, io, ctx) {
    const { values } = parseArgs({
      args: argv,
      options: {
        "max-workers": { type: "string" },
        budget: { type: "string" },
        "sa-command": { type: "string" },
      },
      strict: true,
    });
    const maxWorkers = wholeNumber("--max-workers", values["max-workers"], 2, 1, "a whole number >= 1");
    const budgetTokens = wholeNumber("--budget", values.budget, 2_000_000, 0, "a whole number of tokens >= 0");
    const saCommand = (values["sa-command"] ?? "sa").trim();
    if (!saCommand) throw new UsageError("--sa-command must not be empty");

    const saDir = findSuperagentDir(ctx.cwd);
    const repoRoot = dirname(saDir);

    // Read and check everything before writing anything.
    const { settings, changed: settingsChanged } = mergeSettings(await readClaudeSettings(repoRoot), saCommand);

    const lines: string[] = [];
    if (stateExists(saDir)) {
      lines.push(".superagent/: already initialised (state kept)");
    } else {
      const id = `${ctx.now().toISOString().slice(0, 10)}-a`;
      await initState(saDir, { id, budgetTokens, maxWorkers });
      lines.push(`.superagent/: created (${maxWorkers} workers, ${budgetTokens.toLocaleString("en-US")} tokens)`);
    }

    if (settingsChanged) await writeClaudeSettings(repoRoot, settings);
    lines.push(`.claude/settings.json: ${settingsChanged ? "updated (sa hooks + deny rules)" : "up to date"}`);

    const ignoreChanged = await updateGitignore(repoRoot);
    lines.push(`.gitignore: ${ignoreChanged ? "updated" : "up to date"}`);

    if (settingsChanged || ignoreChanged) {
      lines.push(
        "Next: commit .claude/settings.json and .gitignore before claiming tickets, so worker worktrees get the hooks.",
      );
    }
    io.stdout(`${lines.join("\n")}\n`);
    return EXIT.ok;
  },
};
