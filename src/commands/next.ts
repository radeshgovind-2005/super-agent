import { parseArgs } from "node:util";
import { findSuperagentDir } from "../core/paths.js";
import { loadState } from "../core/state.js";
import { unmetDeps } from "../core/transitions.js";
import type { State, TicketMode } from "../core/types.js";
import { EXIT } from "../io.js";
import type { Command } from "./types.js";

export interface NextTicket {
  id: string;
  title: string;
  mode: TicketMode;
}

/** Ready tickets whose dependencies are all in review or done, sorted by id. */
export function nextTickets(state: State): NextTicket[] {
  return Object.keys(state.tickets)
    .sort()
    .filter((id) => state.tickets[id]!.status === "ready" && unmetDeps(state, id).length === 0)
    .map((id) => {
      const t = state.tickets[id]!;
      return { id, title: t.title, mode: t.mode };
    });
}

export const next: Command = {
  name: "next",
  summary: "List ready tickets whose dependencies are met",
  usage: "Usage: sa next [--json]\n\nPrints one ticket per line as <id><TAB><title>, or a JSON array with --json.\n",
  async main(argv, io, ctx) {
    const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" } }, strict: true });
    const tickets = nextTickets(await loadState(findSuperagentDir(ctx.cwd)));
    if (values.json) io.stdout(`${JSON.stringify(tickets, null, 2)}\n`);
    else for (const t of tickets) io.stdout(`${t.id}\t${t.title}\n`);
    return EXIT.ok;
  },
};
