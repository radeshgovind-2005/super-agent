import { open, readFile, rm, stat } from "node:fs/promises";
import { SaError, isErrno } from "./errors.js";

export interface LockOptions {
  /** Give up after this long. Default 5000 ms. */
  timeoutMs?: number;
  /** Wait between attempts. Default 20 ms. */
  retryMs?: number;
}

/** An unreadable lock file younger than this may belong to a holder that is still writing it. */
const UNREADABLE_GRACE_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` while holding an exclusive lock file. The lock is created with O_EXCL,
 * so only one process (or one async caller) holds it at a time. It records the
 * holder's pid; a lock whose pid is dead is taken over.
 */
export async function withLock<T>(lockPath: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  await acquire(lockPath, opts.timeoutMs ?? 5000, opts.retryMs ?? 20);
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

async function acquire(lockPath: string, timeoutMs: number, retryMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      } finally {
        await handle.close();
      }
      return;
    } catch (e) {
      if (!isErrno(e, "EEXIST")) throw e;
    }

    if (await isStale(lockPath)) {
      // Small race: two waiters may both judge the same lock stale. Stale locks only
      // follow a crash, so we accept that rather than add a more complex protocol.
      await rm(lockPath, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new SaError("LOCK_TIMEOUT", `Timed out after ${timeoutMs} ms waiting for ${lockPath}. Another sa command is running.`);
    }
    await sleep(retryMs);
  }
}

async function isStale(lockPath: string): Promise<boolean> {
  let pid: unknown;
  try {
    pid = (JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown }).pid;
  } catch (e) {
    if (isErrno(e, "ENOENT")) return false; // released meanwhile; just retry
    pid = undefined;
  }

  if (typeof pid !== "number" || !Number.isInteger(pid)) {
    try {
      return Date.now() - (await stat(lockPath)).mtimeMs > UNREADABLE_GRACE_MS;
    } catch {
      return false;
    }
  }
  return !isAlive(pid);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return isErrno(e, "EPERM"); // exists but owned by someone else
  }
}
