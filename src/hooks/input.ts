/** The JSON Claude Code sends a hook command on stdin (only the fields sa uses). */
export interface HookInput {
  cwd?: string;
  hookEventName?: string;
  stopHookActive?: boolean;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

export class HookInputError extends Error {}

export function parseHookInput(text: string): HookInput {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new HookInputError(`could not read hook input: not JSON (${(e as Error).message})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HookInputError("could not read hook input: expected a JSON object");
  }
  const r = raw as Record<string, unknown>;
  const input: HookInput = {};
  if (typeof r.cwd === "string") input.cwd = r.cwd;
  if (typeof r.hook_event_name === "string") input.hookEventName = r.hook_event_name;
  if (typeof r.stop_hook_active === "boolean") input.stopHookActive = r.stop_hook_active;
  if (typeof r.tool_name === "string") input.toolName = r.tool_name;
  if (typeof r.tool_input === "object" && r.tool_input !== null && !Array.isArray(r.tool_input)) {
    input.toolInput = r.tool_input as Record<string, unknown>;
  }
  return input;
}
