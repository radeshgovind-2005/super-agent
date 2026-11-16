import { readFileSync } from "node:fs";

/** Output sinks, injected so tests can capture them. */
export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Exit codes: 0 ok, 1 refused (illegal move, failed eval), 2 bad usage. */
export const EXIT = { ok: 0, refused: 1, usage: 2 } as const;

export const USAGE = `Usage: sa <command> [options]

Commands:
  (none yet; next, claim, event, eval, submit, status arrive in milestone 1)

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

export async function run(argv: readonly string[], io: Io): Promise<number> {
  const [command] = argv;

  if (command === "--version" || command === "-v") {
    io.stdout(`${readVersion()}\n`);
    return EXIT.ok;
  }
  if (command === "--help" || command === "-h") {
    io.stdout(USAGE);
    return EXIT.ok;
  }
  if (command === undefined) {
    io.stderr(USAGE);
    return EXIT.usage;
  }

  io.stderr(`Unknown command: ${command}\n\n${USAGE}`);
  return EXIT.usage;
}
