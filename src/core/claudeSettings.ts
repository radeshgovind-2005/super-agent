/**
 * The Claude Code runner layer: sa's hooks and permission deny rules in the target
 * repo's .claude/settings.json. Merged into whatever the user already has.
 *
 * Worker sessions run in worktrees and read the worktree's own .claude/settings.json,
 * so this file must be committed before tickets are claimed.
 */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SaError, isErrno } from "./errors.js";
import { writeFileAtomic } from "./fsutil.js";
import { isRecord } from "./validate.js";

export const SETTINGS_FILE = join(".claude", "settings.json");

/** The Stop hook runs a whole eval, so it gets 30 minutes; the guard should be instant. */
export const STOP_TIMEOUT_SEC = 1800;
export const GUARD_TIMEOUT_SEC = 30;
export const GUARD_MATCHER = "Read|Write|Edit|MultiEdit|NotebookEdit|Grep|Bash";

const pushTo = (branch: string) => [
  `Bash(git push * ${branch})`,
  `Bash(git push * ${branch} *)`,
  `Bash(git push *:${branch})`,
  `Bash(git push *:refs/heads/${branch})`,
];

/**
 * Second layer behind the PreToolUse guard. Deny rules match command text and
 * gitignore-style paths, so they cannot express everything the guard does (e.g. a
 * bare `git push` while on main); the guard covers those.
 */
export const DENY_RULES: readonly string[] = [
  "Read(**/.env)",
  "Read(**/.env.local)",
  "Read(**/.env.*.local)",
  "Read(**/.env.production)",
  "Read(**/*.pem)",
  "Read(**/*.key)",
  "Read(**/id_rsa*)",
  "Read(**/id_ed25519*)",
  "Read(~/.ssh/**)",
  ...pushTo("main"),
  ...pushTo("master"),
  "Bash(gh pr merge *)",
  "Bash(rm -rf *)",
  "Edit(**/.superagent/state.json)",
  "Edit(**/.superagent/state.lock)",
  "Edit(**/.superagent/events.jsonl)",
  "Edit(**/.superagent/tickets/board.md)",
];

/**
 * Bash commands headless workers (permission mode acceptEdits) may run without a
 * prompt. Anything else is refused, so a worker gets stuck rather than surprising you.
 */
export function allowRules(saCommand: string): string[] {
  return [
    `Bash(${saCommand} *)`,
    "Bash(git add *)",
    "Bash(git commit *)",
    "Bash(git status *)",
    "Bash(git diff *)",
    "Bash(git log *)",
    "Bash(git restore *)",
    "Bash(npm test *)",
    "Bash(npm run *)",
    "Bash(npx vitest *)",
    "Bash(npx tsc *)",
    "Bash(sleep *)",
    "Bash(ps -p *)",
  ];
}

interface Handler {
  type: "command";
  command: string;
  timeout: number;
}
interface Group {
  matcher?: string;
  hooks: Handler[];
}

function ourHooks(saCommand: string): Record<string, Group> {
  const stop: Group = { hooks: [{ type: "command", command: `${saCommand} hook stop`, timeout: STOP_TIMEOUT_SEC }] };
  return {
    Stop: stop,
    SubagentStop: structuredClone(stop),
    PreToolUse: {
      matcher: GUARD_MATCHER,
      hooks: [{ type: "command", command: `${saCommand} hook pre-tool-use`, timeout: GUARD_TIMEOUT_SEC }],
    },
  };
}

/** Our handlers end in "hook stop" / "hook pre-tool-use", whatever command runs sa. */
const isOurs = (h: unknown): boolean =>
  isRecord(h) && typeof h.command === "string" && /\shook (stop|pre-tool-use)$/.test(h.command.trim());

const invalid = (msg: string) => new SaError("INVALID_SETTINGS", `${SETTINGS_FILE}: ${msg}`);

/**
 * Add sa's hooks and deny rules to existing settings. Keeps everything else, replaces
 * older sa hooks instead of duplicating them, and is idempotent.
 */
export function mergeSettings(existing: unknown, saCommand: string): { settings: Record<string, unknown>; changed: boolean } {
  if (!isRecord(existing)) throw invalid("must be a JSON object");
  const settings = structuredClone(existing);

  const permissions = settings.permissions ?? {};
  if (!isRecord(permissions)) throw invalid("permissions must be an object");
  const deny = permissions.deny ?? [];
  if (!Array.isArray(deny)) throw invalid("permissions.deny must be a list");
  for (const rule of DENY_RULES) if (!deny.includes(rule)) deny.push(rule);
  const allow = permissions.allow ?? [];
  if (!Array.isArray(allow)) throw invalid("permissions.allow must be a list");
  for (const rule of allowRules(saCommand)) if (!allow.includes(rule)) allow.push(rule);
  settings.permissions = { ...permissions, allow, deny };

  const hooks = settings.hooks ?? {};
  if (!isRecord(hooks)) throw invalid("hooks must be an object");
  for (const [event, group] of Object.entries(ourHooks(saCommand))) {
    const groups = hooks[event] ?? [];
    if (!Array.isArray(groups)) throw invalid(`hooks.${event} must be a list`);
    const kept = groups.flatMap((g: unknown) => {
      if (!isRecord(g) || !Array.isArray(g.hooks) || !g.hooks.some(isOurs)) return [g];
      const rest = g.hooks.filter((h) => !isOurs(h));
      return rest.length ? [{ ...g, hooks: rest }] : [];
    });
    hooks[event] = [...kept, group];
  }
  settings.hooks = hooks;

  return { settings, changed: JSON.stringify(settings) !== JSON.stringify(existing) };
}

/** True when settings register sa's Stop and PreToolUse hooks. */
export function hasSaHooks(settings: unknown): boolean {
  if (!isRecord(settings) || !isRecord(settings.hooks)) return false;
  const has = (event: string, kind: string) => {
    const groups = (settings.hooks as Record<string, unknown>)[event];
    return (
      Array.isArray(groups) &&
      groups.some(
        (g) =>
          isRecord(g) &&
          Array.isArray(g.hooks) &&
          g.hooks.some((h) => isRecord(h) && typeof h.command === "string" && h.command.trim().endsWith(` hook ${kind}`)),
      )
    );
  };
  return has("Stop", "stop") && has("PreToolUse", "pre-tool-use");
}

/** The command that runs sa, read back from the Stop hook ("<cmd> hook stop"), or null. */
export function saCommandFrom(settings: unknown): string | null {
  if (!isRecord(settings) || !isRecord(settings.hooks) || !Array.isArray(settings.hooks.Stop)) return null;
  for (const g of settings.hooks.Stop) {
    if (!isRecord(g) || !Array.isArray(g.hooks)) continue;
    for (const h of g.hooks) {
      if (isRecord(h) && typeof h.command === "string" && h.command.trim().endsWith(" hook stop")) {
        return h.command.trim().slice(0, -" hook stop".length);
      }
    }
  }
  return null;
}

/** The repo's .claude/settings.json, or {} if there is none. */
export async function readClaudeSettings(repoRoot: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, SETTINGS_FILE), "utf8");
  } catch (e) {
    if (isErrno(e, "ENOENT")) return {};
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SaError("INVALID_SETTINGS", `${SETTINGS_FILE} is not valid JSON (${(e as Error).message})`);
  }
}

export async function writeClaudeSettings(repoRoot: string, settings: Record<string, unknown>): Promise<void> {
  await mkdir(join(repoRoot, ".claude"), { recursive: true });
  await writeFileAtomic(join(repoRoot, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`);
}
