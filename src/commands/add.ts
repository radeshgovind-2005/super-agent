import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { SaError, UsageError, isErrno } from "../core/errors.js";
import { findTicketDir } from "../core/evalfile.js";
import { findSuperagentDir } from "../core/paths.js";
import { slugify } from "../core/slug.js";
import { updateState } from "../core/state.js";
import { evalTemplate, specTemplate } from "../core/templates.js";
import { addTicket } from "../core/transitions.js";
import { TICKET_ID, TICKET_MODES, type State, type TicketMode } from "../core/types.js";
import { EXIT } from "../io.js";
import type { Command } from "./types.js";

/** The ticket's folder: the existing one if the router made it, else a new <id>-<slug>. */
async function ticketDir(saDir: string, id: string, title: string): Promise<string> {
  try {
    return await findTicketDir(saDir, id);
  } catch (e) {
    if (e instanceof SaError && /^No ticket folder/.test(e.message)) {
      return join(saDir, "tickets", `${id}-${slugify(title)}`);
    }
    throw e;
  }
}

async function writeIfMissing(file: string, text: string): Promise<void> {
  try {
    await writeFile(file, text, { flag: "wx" });
  } catch (e) {
    if (!isErrno(e, "EEXIST")) throw e;
  }
}

export const add: Command = {
  name: "add",
  summary: "Add a draft ticket and scaffold its spec.md and eval.md",
  usage: `Usage: sa add <id> --title <text> [--mode solo|team] [--after <id,id,...>]

Adds a draft ticket (id: 3+ digits) and creates tickets/<id>-<slug>/ with
template spec.md and eval.md, keeping any files that already exist.
`,
  async main(argv, io, ctx) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { title: { type: "string" }, mode: { type: "string" }, after: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    const [id, ...extra] = positionals;
    if (!id || extra.length) throw new UsageError("Expected exactly one ticket <id>");
    if (!TICKET_ID.test(id)) throw new UsageError(`Bad id ${id}: ticket id must be 3+ digits, like 001`);
    const title = values.title?.trim();
    if (!title) throw new UsageError("Missing --title <text>");
    const mode = (values.mode ?? "solo") as TicketMode;
    if (!TICKET_MODES.includes(mode)) throw new UsageError("--mode must be solo or team");
    const dependsOn = (values.after ?? "").split(",").map((d) => d.trim()).filter(Boolean);

    const saDir = findSuperagentDir(ctx.cwd);
    const next: State = await updateState(saDir, (s) => addTicket(s, id, { title, mode, dependsOn }));

    const dir = await ticketDir(saDir, id, title);
    await mkdir(dir, { recursive: true });
    const deps = dependsOn.map((d) => ({ id: d, title: next.tickets[d]!.title }));
    await writeIfMissing(join(dir, "spec.md"), specTemplate(id, title, deps));
    await writeIfMissing(join(dir, "eval.md"), evalTemplate(id, title));

    io.stdout(`Added ${id} (draft): ${relative(dirname(saDir), dir)}\n`);
    return EXIT.ok;
  },
};
