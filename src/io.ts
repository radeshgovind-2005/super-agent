/** Output sinks, injected so tests can capture them. */
export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Exit codes: 0 ok, 1 refused (illegal move, failed eval, missing setup), 2 bad usage. */
export const EXIT = { ok: 0, refused: 1, usage: 2 } as const;
