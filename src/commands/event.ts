import { parseArgs } from "node:util";
import { appendEvent } from "../core/events.js";
import { SaError, UsageError } from "../core/errors.js";
import { findSuperagentDir } from "../core/paths.js";
import { loadState } from "../core/state.js";
import type { EventType, SaEvent } from "../core/types.js";
import { isRecord } from "../core/validate.js";
import { EXIT } from "../io.js";
import { resolveAgent } from "./agent.js";
import type { Command } from "./types.js";

/** Only sa itself writes these, so an agent cannot fake a claim, a passing eval, or a PR. */
const SA_ONLY: readonly EventType[] = ["claim", "eval", "pr_opened"];
const RESERVED_FIELDS = ["t", "agent", "ticket", "type"] as const;

function parsePayload(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaError("INVALID_EVENT", "Invalid event: payload is not valid JSON");
  }
  if (!isRecord(raw)) throw new SaError("INVALID_EVENT", "Invalid event: payload must be a JSON object");
  for (const field of RESERVED_FIELDS) {
    if (field in raw) throw new SaError("INVALID_EVENT", `Invalid event: payload may not set ${field}`);
  }
  return raw;
}

export const event: Command = {
  name: "event",
  summary: "Append one event to the log",
  usage: `Usage: sa event <id> <type> [json] [--agent <name>]

Types an agent may write: heartbeat, commit, question, blocked, done, tokens.
The optional JSON object adds fields to the event. --agent defaults to $SA_AGENT.
`,
  async main(argv, io, ctx) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { agent: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    const [id, type, payloadText, ...extra] = positionals;
    if (!id || !type || extra.length) throw new UsageError("Expected <id> <type> [json]");
    const agent = resolveAgent(values.agent, ctx);

    const saDir = findSuperagentDir(ctx.cwd);
    if (!(await loadState(saDir)).tickets[id]) throw new SaError("UNKNOWN_TICKET", `Unknown ticket ${id}`);
    if ((SA_ONLY as readonly string[]).includes(type)) {
      throw new SaError("INVALID_EVENT", `Invalid event: sa writes ${type} events itself`);
    }

    const e = { ...parsePayload(payloadText), t: ctx.now().toISOString(), agent, ticket: id, type } as SaEvent;
    await appendEvent(saDir, e); // validates the type
    return EXIT.ok;
  },
};
