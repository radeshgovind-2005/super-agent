export type ErrorCode =
  | "NOT_IN_REPO"
  | "NOT_INITIALIZED"
  | "INVALID_STATE"
  | "INVALID_EVENT"
  | "LOCK_TIMEOUT"
  | "UNKNOWN_TICKET"
  | "ILLEGAL_TRANSITION"
  | "DEPS_UNMET"
  | "MAX_WORKERS"
  | "EVAL_NOT_PASSED"
  | "STALE_EVAL"
  | "GIT_FAILED"
  | "EVAL_FILE"
  | "NO_COMMAND_CHECK";

/** The command was called wrongly (missing argument, bad name). The CLI prints usage and exits 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** An expected, user-facing failure. The CLI prints the message and exits 1 ("refused"). */
export class SaError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "SaError";
    this.code = code;
  }
}

export function isErrno(e: unknown, code: string): boolean {
  return e instanceof Error && (e as NodeJS.ErrnoException).code === code;
}
