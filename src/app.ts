import { readFileSync } from "node:fs";
import { next } from "./commands/next.js";
import { status } from "./commands/status.js";
import type { Command, Ctx } from "./commands/types.js";
import { SaError } from "./core/errors.js";
import { EXIT, type Io } from "./io.js";

export { EXIT, type Io } from "./io.js";
export type { Ctx } from "./commands/types.js";

const COMMANDS: readonly Command[] = [next, status];

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

  const full: Ctx = { cwd: ctx.cwd ?? process.cwd(), now: ctx.now ?? (() => new Date()) };
  try {
    return await command.main(rest, io, full);
  } catch (e) {
    if (isParseArgsError(e)) {
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
