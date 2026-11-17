import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SaError, UsageError, isErrno } from "../core/errors.js";
import { findTicketDir, parseEvalMarkdown } from "../core/evalfile.js";
import { readEvents } from "../core/events.js";
import { writeFileAtomic } from "../core/fsutil.js";
import { findSuperagentDir } from "../core/paths.js";
import { loadState } from "../core/state.js";
import { EXIT } from "../io.js";
import { buildReport, type TicketDocs } from "../report/build.js";
import { renderReportHtml } from "../report/html.js";
import { markdownSection } from "../report/markdown.js";
import type { Command } from "./types.js";

async function readOptional(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    if (isErrno(e, "ENOENT")) return "";
    throw e;
  }
}

/** What the report needs from a ticket's files. Missing or broken files give empty fields, never an error. */
async function ticketDocs(saDir: string, id: string): Promise<TicketDocs> {
  let dir: string;
  try {
    dir = await findTicketDir(saDir, id);
  } catch (e) {
    if (e instanceof SaError) return { ticketDir: null, goal: "", decisions: "", unusual: "", doneMeans: "", checks: [] };
    throw e;
  }
  const spec = await readOptional(join(dir, "spec.md"));
  const evalText = await readOptional(join(dir, "eval.md"));
  let checks: TicketDocs["checks"] = [];
  try {
    checks = parseEvalMarkdown(evalText).map((c) => ({ id: c.id, type: c.type, run: c.run }));
  } catch (e) {
    if (!(e instanceof SaError)) throw e;
  }
  return {
    ticketDir: relative(dirname(saDir), dir),
    goal: markdownSection(spec, "Goal"),
    decisions: markdownSection(spec, "Decisions"),
    unusual: markdownSection(evalText, "Unusual cases"),
    doneMeans: markdownSection(evalText, "Done means"),
    checks,
  };
}

export const report: Command = {
  name: "report",
  summary: "Build the run's review report (HTML) and run.json",
  usage: `Usage: sa report [--out <file.html>] [--json]

Writes .superagent/runs/<run>/report.html (or --out) and run.json: a summary,
what went wrong, and one card per ticket with its eval results, PR link and a
ready prompt to ask Claude about it. --json prints the report data.
`,
  async main(argv, io, ctx) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { out: { type: "string" }, json: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length) throw new UsageError("sa report takes no arguments");

    const saDir = findSuperagentDir(ctx.cwd);
    const state = await loadState(saDir);
    const events = await readEvents(saDir);
    const docs: Record<string, TicketDocs> = {};
    for (const id of Object.keys(state.tickets)) docs[id] = await ticketDocs(saDir, id);
    const data = buildReport(state, events, docs, ctx.now());

    const runDir = join(saDir, "runs", state.run.id);
    await mkdir(runDir, { recursive: true });
    const htmlPath = values.out ? resolve(ctx.cwd, values.out) : join(runDir, "report.html");
    await mkdir(dirname(htmlPath), { recursive: true });
    await writeFileAtomic(htmlPath, renderReportHtml(data));
    const jsonPath = join(runDir, "run.json");
    await writeFileAtomic(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

    if (values.json) {
      io.stdout(`${JSON.stringify(data, null, 2)}\n`);
    } else {
      const s = data.summary;
      io.stdout(
        `Report: ${htmlPath}\nRun data: ${jsonPath}\n` +
          `${s.tickets} tickets: ${s.shipped} shipped, ${s.blocked} blocked, ${s.inProgress} in progress, ${s.notStarted} not started\n`,
      );
    }
    return EXIT.ok;
  },
};
