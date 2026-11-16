import type { Io } from "../io.js";

/** What a command may depend on from the outside world; injected so tests control it. */
export interface Ctx {
  cwd: string;
  now: () => Date;
}

export interface Command {
  name: string;
  summary: string;
  usage: string;
  /** Parses its own args with node:util parseArgs (strict); returns an exit code. */
  main: (argv: string[], io: Io, ctx: Ctx) => Promise<number>;
}
