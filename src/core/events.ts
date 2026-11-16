import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SaError, isErrno } from "./errors.js";
import { EVENTS_FILE } from "./paths.js";
import { EVENT_TYPES, TICKET_ID, type SaEvent } from "./types.js";
import { isRecord, isoTime, oneOf, str, type Problems } from "./validate.js";

function validateEvent(raw: unknown, where: string): SaEvent {
  const p: Problems = [];
  if (!isRecord(raw)) throw new SaError("INVALID_EVENT", `${where}: expected a JSON object`);
  isoTime(p, "t", raw.t);
  str(p, "agent", raw.agent);
  if (typeof raw.ticket !== "string" || !TICKET_ID.test(raw.ticket)) p.push("ticket: expected a ticket id like 001");
  oneOf(p, "type", raw.type, EVENT_TYPES);
  if (p.length) throw new SaError("INVALID_EVENT", `${where}: ${p.join("; ")}`);
  return raw as SaEvent;
}

/**
 * Append one event as a single line. Each append is one O_APPEND write of a short
 * line, so parallel writers do not interleave. The log is never rewritten.
 */
export async function appendEvent(saDir: string, event: SaEvent): Promise<void> {
  validateEvent(event, "Invalid event");
  try {
    await appendFile(join(saDir, EVENTS_FILE), `${JSON.stringify(event)}\n`, { flag: "a" });
  } catch (e) {
    if (isErrno(e, "ENOENT")) {
      throw new SaError("NOT_INITIALIZED", `No ${saDir} folder. Run /superagent init first.`);
    }
    throw e;
  }
}

/** All events in order. A torn final line (crash mid-append) is skipped; corruption elsewhere is an error. */
export async function readEvents(saDir: string): Promise<SaEvent[]> {
  let text: string;
  try {
    text = await readFile(join(saDir, EVENTS_FILE), "utf8");
  } catch (e) {
    if (isErrno(e, "ENOENT")) return [];
    throw e;
  }

  const lines = text.split("\n");
  lines.pop(); // drop what follows the last "\n": "" normally, or a torn partial line

  return lines.flatMap((line, i) => {
    if (line.trim() === "") return [];
    const where = `${EVENTS_FILE} line ${i + 1}`;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new SaError("INVALID_EVENT", `${where}: not valid JSON`);
    }
    return [validateEvent(raw, where)];
  });
}
