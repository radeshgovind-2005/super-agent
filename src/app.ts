import { readFileSync } from "node:fs";
import { add } from "./commands/add.js";
import { block } from "./commands/block.js";
import { claim } from "./commands/claim.js";
import { evalCmd } from "./commands/eval.js";
import { event } from "./commands/event.js";
import { init } from "./commands/init.js";
import { next } from "./commands/next.js";
import { ready } from "./commands/ready.js";
import { status } from "./commands/status.js";
import { submit } from "./commands/submit.js";
import type { Command, Ctx } from "./commands/types.js";
import { SaError, UsageError } from "./core/errors.js";
import { EXIT, type Io } from "./io.js";

export { EXIT, type Io } from "./io.js";
export type { Ctx } from "./commands/types.js";

const COMMANDS: readonly Command[] = [init, add, ready, next, claim, event, evalCmd, submit, block, status];

const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;

export const USAGE = `Usage: sa <command> [options]

Commands:
${COMMANDS.map((c) => `  ${c.name.padEnd(width)}${c.summary}`).join("\n")}

Options:
  -h, --help     Show this help
  -v, --version  Show the version
`;

function readVersion(): string {
  // Works from both src/ (tests) and dist/ (built bin): package.json is one level up.
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return pkg.version;
}

const isParseArgsError = (e: unknown): e is Error =>
  e instanceof Error && String((e as NodeJS.ErrnoException).code).startsWith("ERR_PARSE_ARGS");

export async function run(argv: readonly string[], io: Io, ctx: Partial<Ctx> = {}): Promise<number> {
  const [name, ...rest] = argv;

  if (name === "--version" || name === "-v") {
    io.stdout(`${readVersion()}\n`);
    return EXIT.ok;
  }
  if (name === "--help" || name === "-h") {
    io.stdout(USAGE);
    return EXIT.ok;
  }
  if (name === undefined) {
    io.stderr(USAGE);
    return EXIT.usage;
  }

  const command = COMMANDS.find((c) => c.name === name);
  if (!command) {
    io.stderr(`Unknown command: ${name}\n\n${USAGE}`);
    return EXIT.usage;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    io.stdout(command.usage);
    return EXIT.ok;
  }

  const full: Ctx = {
    cwd: ctx.cwd ?? process.cwd(),
    now: ctx.now ?? (() => new Date()),
    env: ctx.env ?? process.env,
  };
  try {
    return await command.main(rest, io, full);
  } catch (e) {
    if (isParseArgsError(e) || e instanceof UsageError) {
      io.stderr(`sa ${name}: ${e.message}\n\n${command.usage}`);
      return EXIT.usage;
    }
    if (e instanceof SaError) {
      io.stderr(`sa: ${e.message}\n`);
      return EXIT.refused;
    }
    throw e;
  }
}
