import { spawnSync } from "node:child_process";
import { readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withLock } from "../../src/core/lock.js";
import { tempDir } from "../helpers.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A pid that existed a moment ago and is now dead. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "0"]);
  return child.pid!;
}

describe("withLock", () => {
  it("runs the function, returns its value, and removes the lock", async () => {
    const dir = await tempDir();
    const lock = join(dir, "state.lock");
    expect(await withLock(lock, async () => 42)).toBe(42);
    expect(await readdir(dir)).toEqual([]);
  });

  it("removes the lock when the function throws", async () => {
    const dir = await tempDir();
    const lock = join(dir, "state.lock");
    await expect(withLock(lock, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await readdir(dir)).toEqual([]);
  });

  it("makes a second holder wait for the first", async () => {
    const dir = await tempDir();
    const lock = join(dir, "state.lock");
    const order: string[] = [];
    const first = withLock(lock, async () => {
      order.push("first:start");
      await sleep(60);
      order.push("first:end");
    });
    await sleep(5);
    const second = withLock(lock, async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("fails with LOCK_TIMEOUT when a live holder keeps the lock", async () => {
    const dir = await tempDir();
    const lock = join(dir, "state.lock");
    await writeFile(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    await expect(withLock(lock, async () => 1, { timeoutMs: 80, retryMs: 10 })).rejects.toMatchObject({
      code: "LOCK_TIMEOUT",
    });
  });

  it("takes over a lock left by a dead process", async () => {
    const dir = await tempDir();
    const lock = join(dir, "state.lock");
    await writeFile(lock, JSON.stringify({ pid: deadPid(), at: new Date().toISOString() }));
    expect(await withLock(lock, async () => "ok", { timeoutMs: 200 })).toBe("ok");
  });

  it("takes over an unreadable lock file once it is old", async () => {
    const dir = await tempDir();
    const lock = join(dir, "state.lock");
    await writeFile(lock, "");
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    expect(await withLock(lock, async () => "ok", { timeoutMs: 200 })).toBe("ok");
  });

  it("waits on a fresh unreadable lock file (holder may be mid-write)", async () => {
    const dir = await tempDir();
    const lock = join(dir, "state.lock");
    await writeFile(lock, "");
    await expect(withLock(lock, async () => 1, { timeoutMs: 80, retryMs: 10 })).rejects.toMatchObject({
      code: "LOCK_TIMEOUT",
    });
  });
});
