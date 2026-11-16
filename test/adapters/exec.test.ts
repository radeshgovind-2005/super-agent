import { realpath } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runShell } from "../../src/adapters/exec.js";
import { tempDir } from "../helpers.js";

describe("runShell", () => {
  it("reports exit code 0 and captures stdout and stderr together", async () => {
    const r = await runShell("echo out; echo err >&2", { cwd: await tempDir(), timeoutMs: 5000 });
    expect(r).toMatchObject({ exitCode: 0, timedOut: false });
    expect(r.output).toContain("out");
    expect(r.output).toContain("err");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a non-zero exit code", async () => {
    expect((await runShell("exit 3", { cwd: await tempDir(), timeoutMs: 5000 })).exitCode).toBe(3);
  });

  it("runs in the given folder", async () => {
    const dir = await tempDir();
    const r = await runShell("pwd -P", { cwd: dir, timeoutMs: 5000 });
    expect(r.output.trim()).toBe(await realpath(dir));
  });

  it("passes extra environment variables", async () => {
    const r = await runShell('echo "$SA_TICKET"', { cwd: await tempDir(), timeoutMs: 5000, env: { SA_TICKET: "001" } });
    expect(r.output.trim()).toBe("001");
  });

  it("kills the command and its children on timeout", async () => {
    const started = Date.now();
    const r = await runShell("sleep 10; echo late", { cwd: await tempDir(), timeoutMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(r.output).not.toContain("late");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("keeps only the tail of very long output", async () => {
    const r = await runShell("i=0; while [ $i -lt 5000 ]; do echo line-$i; i=$((i+1)); done", {
      cwd: await tempDir(),
      timeoutMs: 10_000,
      maxOutputBytes: 1000,
    });
    expect(r.output.length).toBeLessThanOrEqual(1000);
    expect(r.output).toContain("line-4999");
    expect(r.output).not.toContain("line-0\n");
  });
});
