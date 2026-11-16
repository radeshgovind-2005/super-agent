import { parseArgs } from "node:util";
import { UsageError } from "../core/errors.js";
import { appendEvent } from "../core/events.js";
import { findSuperagentDir } from "../core/paths.js";
import { updateState } from "../core/state.js";
import { block as blockTransition } from "../core/transitions.js";
import { EXIT } from "../io.js";
import { resolveAgent } from "./agent.js";
import type { Command } from "./types.js";

export const block: Command = {
  name: "block",
  summary: "Block a ready or in-progress ticket, with a reason",
  usage: `Usage: sa block <id> --reason <text> [--agent <name>]

Moves the ticket to blocked, frees its owner, and logs a blocked event with the
reason. Use sa ready <id> to unblock. --agent defaults to $SA_AGENT.
`,
  async main(argv, io, ctx) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { reason: { type: "string" }, agent: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    const [id, ...extra] = positionals;
    if (!id || extra.length) throw new UsageError("Expected exactly one ticket <id>");
    const reason = values.reason?.trim();
    if (!reason) throw new UsageError("Missing --reason <text>");
    const agent = resolveAgent(values.agent, ctx);

    const saDir = findSuperagentDir(ctx.cwd);
    await updateState(saDir, (s) => blockTransition(s, id));
    await appendEvent(saDir, { t: ctx.now().toISOString(), agent, ticket: id, type: "blocked", reason });
    io.stdout(`Blocked ${id}: ${reason}\n`);
    return EXIT.ok;
  },
};
