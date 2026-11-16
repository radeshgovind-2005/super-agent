import { parseArgs } from "node:util";
import { readEvents } from "../core/events.js";
import { findSuperagentDir } from "../core/paths.js";
import { loadState } from "../core/state.js";
import type { EventType, SaEvent, State, Ticket } from "../core/types.js";
import { EXIT } from "../io.js";
import type { Command } from "./types.js";

export interface TicketStatusRow extends Ticket {
  id: string;
  lastEvent: { type: EventType; t: string; agent: string } | null;
  /** Seconds since lastEvent, or null if the ticket has no events. */
  idleSeconds: number | null;
}

export interface StatusReport {
  run: State["run"] & { busyWorkers: number };
  tickets: TicketStatusRow[];
}

/** Join state with each ticket's latest event (by log order). Pure: no I/O. */
export function buildStatus(state: State, events: readonly SaEvent[], now: Date): StatusReport {
  const latest = new Map<string, SaEvent>();
  for (const e of events) latest.set(e.ticket, e);

  const tickets = Object.keys(state.tickets)
    .sort()
    .map((id): TicketStatusRow => {
      const e = latest.get(id);
      return {
        id,
        ...state.tickets[id]!,
        lastEvent: e ? { type: e.type, t: e.t, agent: e.agent } : null,
        idleSeconds: e ? Math.max(0, Math.floor((now.getTime() - Date.parse(e.t)) / 1000)) : null,
      };
    });

  const busyWorkers = tickets.filter((t) => t.status === "in_progress").length;
  return { run: { ...state.run, busyWorkers }, tickets };
}

/** Largest whole unit: 59s, 59m, 23h, 1d. */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function renderStatus(report: StatusReport): string {
  const { run } = report;
  const lines = [
    `Run ${run.id} · ${run.busyWorkers} of ${run.maxWorkers} workers busy · budget ${run.budgetTokens.toLocaleString("en-US")} tokens`,
    "",
  ];
  if (report.tickets.length === 0) {
    lines.push("No tickets yet.", "");
    return lines.join("\n");
  }

  const rows = [
    ["ID", "STATUS", "MODE", "OWNER", "LAST EVENT", "TITLE"],
    ...report.tickets.map((t) => [
      t.id,
      t.status,
      t.mode,
      t.owner ?? "–",
      t.lastEvent && t.idleSeconds !== null ? `${formatAge(t.idleSeconds)} ago (${t.lastEvent.type})` : "–",
      t.title,
    ]),
  ];
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((r) => r[col]!.length)));
  for (const r of rows) {
    lines.push(r.map((cell, col) => (col === r.length - 1 ? cell : cell.padEnd(widths[col]! + 2))).join(""));
  }
  lines.push("");
  return lines.join("\n");
}

export const status: Command = {
  name: "status",
  summary: "Show every ticket, its owner, and time since its last event",
  usage: "Usage: sa status [--json]\n\nPrints a table, or the full report as JSON with --json.\n",
  async main(argv, io, ctx) {
    const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" } }, strict: true });
    const saDir = findSuperagentDir(ctx.cwd);
    const report = buildStatus(await loadState(saDir), await readEvents(saDir), ctx.now());
    io.stdout(values.json ? `${JSON.stringify(report, null, 2)}\n` : renderStatus(report));
    return EXIT.ok;
  },
};
