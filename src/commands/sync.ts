import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { prState, type PrState } from "../adapters/gh.js";
import { UsageError } from "../core/errors.js";
import { appendEvent } from "../core/events.js";
import { findSuperagentDir } from "../core/paths.js";
import { loadState, updateState } from "../core/state.js";
import { markDone } from "../core/transitions.js";
import type { TicketStatus } from "../core/types.js";
import { EXIT } from "../io.js";
import type { Command } from "./types.js";

interface Row {
  id: string;
  pr: string;
  prState: PrState;
  status: TicketStatus;
}

const NOTE: Record<PrState, string> = {
  MERGED: "merged",
  OPEN: "still open",
  CLOSED: "closed without merging: reopen it, or re-run the ticket",
};

export const sync: Command = {
  name: "sync",
  summary: "Mark tickets done whose PRs a human has merged",
  usage: `Usage: sa sync [--json]

Asks GitHub (gh) about the PR of every ticket in review. A merged PR moves its
ticket to done and logs a done event. Open PRs, and PRs closed without merging,
are listed and left in review. Safe to run any time.
`,
  async main(argv, io, ctx) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { json: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length) throw new UsageError("sa sync takes no arguments");

    const saDir = findSuperagentDir(ctx.cwd);
    const inReview = Object.entries((await loadState(saDir)).tickets)
      .filter(([, t]) => t.status === "review" && t.pr)
      .sort(([a], [b]) => a.localeCompare(b));
    if (!inReview.length && !values.json) {
      io.stdout("No tickets in review.\n");
      return EXIT.ok;
    }

    // Ask gh about every PR first, so a gh failure changes nothing.
    const gh = { cwd: dirname(saDir), env: ctx.env };
    const rows: Row[] = inReview.map(([id, t]) => ({ id, pr: t.pr!, prState: prState(t.pr!, gh), status: "review" }));

    const done: string[] = [];
    await updateState(saDir, (s) => {
      let next = s;
      for (const row of rows) {
        // Another sa may have moved the ticket while gh was answering; only review → done.
        if (row.prState !== "MERGED" || next.tickets[row.id]?.status !== "review") continue;
        next = markDone(next, row.id);
        done.push(row.id);
      }
      return next;
    });
    for (const row of rows) if (done.includes(row.id)) row.status = "done";
    for (const id of done) {
      const pr = rows.find((r) => r.id === id)!.pr;
      await appendEvent(saDir, { t: ctx.now().toISOString(), agent: "sa", ticket: id, type: "done", pr });
    }

    if (values.json) {
      io.stdout(`${JSON.stringify({ tickets: rows, done }, null, 2)}\n`);
    } else {
      const lines = rows.map((r) => `${r.id}  ${r.status.padEnd(6)}  ${r.pr} ${NOTE[r.prState]}`);
      lines.push("", `${done.length} ${done.length === 1 ? "ticket" : "tickets"} marked done.`);
      io.stdout(`${lines.join("\n")}\n`);
    }
    return EXIT.ok;
  },
};
