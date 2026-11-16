import { UsageError } from "../core/errors.js";
import type { Ctx } from "./types.js";

const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The calling agent's name: --agent, else $SA_AGENT. */
export function resolveAgent(flag: string | undefined, ctx: Ctx): string {
  const agent = flag ?? ctx.env.SA_AGENT;
  if (!agent) throw new UsageError("Missing --agent <name> (or set SA_AGENT)");
  if (!AGENT_NAME.test(agent)) {
    throw new UsageError(`Bad agent name ${JSON.stringify(agent)}: use letters, digits, ".", "_" or "-"`);
  }
  return agent;
}
