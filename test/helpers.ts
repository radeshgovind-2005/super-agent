import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { State, Ticket, TicketStatus } from "../src/core/types.js";

const made: string[] = [];

/** A fresh temp dir (realpath'd, so macOS /var vs /private/var compares equal), removed after each test. */
export async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "sa-test-")));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A temp dir holding an initialised .superagent/ folder; returns the .superagent path. */
export async function tempSaDir(): Promise<string> {
  const dir = join(await tempDir(), ".superagent");
  await mkdir(dir, { recursive: true });
  return dir;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=sa-test", "-c", "user.email=sa-test@example.invalid", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

/**
 * A temp git repo named "repo" with one empty commit on main. It sits one level
 * inside its temp dir, so sa's sibling worktree folder (../.sa-worktrees) is cleaned up too.
 */
export async function tempRepo(): Promise<string> {
  const dir = join(await tempDir(), "repo");
  await mkdir(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

export function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    title: "A ticket",
    status: "draft",
    mode: "solo",
    dependsOn: [],
    branch: null,
    worktree: null,
    owner: null,
    attempts: 0,
    lastEval: null,
    pr: null,
    ...overrides,
  };
}

/** A ticket in `status`, with the companion fields that status needs to be valid. */
export function ticketIn(status: TicketStatus, overrides: Partial<Ticket> = {}): Ticket {
  const claimed = {
    owner: "worker-1",
    branch: "sa/001-a-ticket",
    worktree: "../.sa-worktrees/001",
    attempts: 1,
    lastEval: { result: "pass" as const, at: "2026-11-16T19:40:00.000Z", failed: [], commit: "abc123" },
  };
  switch (status) {
    case "draft":
    case "ready":
      return ticket({ status, ...overrides });
    case "in_progress":
      return ticket({ status, ...claimed, ...overrides });
    case "review":
    case "done":
      return ticket({ status, ...claimed, owner: null, pr: "https://github.com/o/r/pull/1", ...overrides });
    case "blocked":
      return ticket({ status, attempts: 1, ...overrides });
  }
}

export function state(tickets: Record<string, Ticket> = {}, run: Partial<State["run"]> = {}): State {
  return {
    version: 1,
    run: { id: "2026-11-16-a", budgetTokens: 2_000_000, maxWorkers: 2, ...run },
    tickets,
  };
}

/** A temp git repo with .superagent/state.json written from `s`. */
export async function tempProject(s: State): Promise<{ repo: string; saDir: string }> {
  const repo = await tempRepo();
  const saDir = join(repo, ".superagent");
  await mkdir(saDir, { recursive: true });
  const { saveState } = await import("../src/core/state.js");
  await saveState(saDir, s);
  return { repo, saDir };
}

/** Captures stdout/stderr for run(). */
export function captureIo(): { stdout: (s: string) => void; stderr: (s: string) => void; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    stdout: (s) => void (out += s),
    stderr: (s) => void (err += s),
    out: () => out,
    err: () => err,
  };
}

/** Recursively freezes a value, so tests catch any mutation by "pure" functions. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
