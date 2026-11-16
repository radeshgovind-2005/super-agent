import { spawn } from "node:child_process";

export interface ShellOptions {
  cwd: string;
  timeoutMs: number;
  /** Added to the current environment. */
  env?: Record<string, string>;
  /** Keep only this many trailing characters of output. Default 64 KiB. */
  maxOutputBytes?: number;
}

export interface ShellResult {
  /** null when the command was killed (timeout) or could not start. */
  exitCode: number | null;
  timedOut: boolean;
  /** stdout and stderr interleaved, tail only. */
  output: string;
  durationMs: number;
}

/**
 * Run `command` with sh in its own process group, so a timeout kills the
 * command and everything it started.
 */
export function runShell(command: string, opts: ShellOptions): Promise<ShellResult> {
  const max = opts.maxOutputBytes ?? 64 * 1024;
  const started = Date.now();

  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const add = (chunk: Buffer | string) => {
      output = (output + chunk.toString()).slice(-max);
    };

    const child = spawn("sh", ["-c", command], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", add);
    child.stderr.on("data", add);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, opts.timeoutMs);

    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? null : exitCode, timedOut, output, durationMs: Date.now() - started });
    };
    child.on("error", (e) => {
      add(`${e.message}\n`);
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
