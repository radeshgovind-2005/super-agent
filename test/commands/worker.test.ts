import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { readEvents } from "../../src/core/events.js";
import { captureIo, git, state, tempDir, tempProject, ticketIn } from "../helpers.js";
import { FEATURE_EVAL, NOW, evalMd } from "./fixtures.js";

const FAKE_CLAUDE = `#!/bin/sh
# Fake claude: record argv, cwd and sa env vars as JSON lines, then exit.
{
  printf '{"cwd":"%s","ticket":"%s","agent":"%s"}\\n' "$(pwd -P)" "$SA_TICKET" "$SA_AGENT"
  for a in "$@"; do printf '%s' "$a" | tr '\\n' '\\036'; echo; done
} > "$FAKE_CLAUDE_OUT.tmp"
mv "$FAKE_CLAUDE_OUT.tmp" "$FAKE_CLAUDE_OUT"  # appear complete, never half-written
echo "worker output"
`;

async function fakeClaude() {
  const bin = join(await tempDir(), "bin");
  await mkdir(bin);
  await writeFile(join(bin, "claude"), FAKE_CLAUDE);
  await chmod(join(bin, "claude"), 0o755);
  const out = join(bin, "record.txt");
  return { env: { PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_CLAUDE_OUT: out }, out };
}

/** Wait for the detached fake claude to write its record. */
async function record(out: string) {
  for (let i = 0; i < 150 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 20));
  const [meta, ...args] = (await readFile(out, "utf8")).trimEnd().split("\n");
  return { meta: JSON.parse(meta!) as { cwd: string; ticket: string; agent: string }, args: args.map((a) => a.replaceAll("\x1e", "\n")) };
}

async function sa(cwd: string, env: Record<string, string>, ...argv: string[]) {
  const io = captureIo();
  const code = await run(argv, io, { cwd, now: () => NOW, env });
  return { code, out: io.out(), err: io.err() };
}

/** A repo set up with sa init (settings committed unless told otherwise), ticket 001 claimed by worker-001. */
async function project(opts: { commitSettings?: boolean } = {}) {
  const p = await tempProject(state({ "001": ticketIn("ready", { title: "Add tags" }), "002": ticketIn("ready", { title: "Other" }) }));
  await sa(p.repo, {}, "init");
  if (opts.commitSettings ?? true) {
    git(p.repo, "add", ".claude", ".gitignore");
    git(p.repo, "commit", "-q", "-m", "chore: set up super agent");
  }
  const dir = join(p.saDir, "tickets", "001-add-tags");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "eval.md"), evalMd(FEATURE_EVAL));
  const claim = await sa(p.repo, {}, "claim", "001", "--agent", "worker-001", "--json");
  if (claim.code !== 0) throw new Error(claim.err);
  return { ...p, wt: (JSON.parse(claim.out) as { worktree: string }).worktree };
}

describe("sa worker start", () => {
  it("starts claude -p as the worker agent in the ticket worktree with SA_TICKET and SA_AGENT", async () => {
    const p = await project();
    const fake = await fakeClaude();
    const r = await sa(p.repo, fake.env, "worker", "start", "001");
    expect(r.err).toBe("");
    expect(r.code).toBe(0);

    const { meta, args } = await record(fake.out);
    expect(meta).toEqual({ cwd: p.wt, ticket: "001", agent: "worker-001" });
    expect(args.slice(0, 1)).toEqual(["-p"]);
    expect(args).toEqual(
      expect.arrayContaining(["--agent", "worker", "--model", "sonnet", "--permission-mode", "acceptEdits"]),
    );
    const prompt = args[1]!;
    expect(prompt).toContain("ticket 001: Add tags");
    expect(prompt).toContain(".superagent/tickets/001-add-tags/spec.md");
    expect(prompt).toContain("sa submit 001");

    const log = join(p.saDir, "runs", "2026-11-16-a", "001-attempt1.log");
    expect(r.out).toMatch(new RegExp(`^Started worker-001 on 001 \\(pid \\d+\\)\\nLog: ${log.replace(/[.]/g, "\\.")}\\n$`));
    for (let i = 0; i < 50 && !(await readFile(log, "utf8").catch(() => "")).includes("worker output"); i++) {
      await new Promise((res) => setTimeout(res, 20));
    }
    expect(await readFile(log, "utf8")).toContain("worker output");

    const started = (await readEvents(p.saDir)).find((e) => e.type === "heartbeat");
    expect(started).toMatchObject({ agent: "worker-001", ticket: "001", note: "worker started", log });
    expect(typeof started?.pid).toBe("number");
  });

  it("accepts --model and prints JSON with --json", async () => {
    const p = await project();
    const fake = await fakeClaude();
    const r = await sa(p.repo, fake.env, "worker", "start", "001", "--model", "opus", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ id: "001", agent: "worker-001", worktree: p.wt });
    expect((await record(fake.out)).args).toEqual(expect.arrayContaining(["--model", "opus"]));
  });

  it("--dry-run prints the command and starts nothing", async () => {
    const p = await project();
    const fake = await fakeClaude();
    const r = await sa(p.repo, fake.env, "worker", "start", "001", "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toContain(`cd '${p.wt}'`);
    expect(r.out).toContain("SA_TICKET=001 SA_AGENT=worker-001 claude -p");
    await new Promise((res) => setTimeout(res, 100));
    expect(existsSync(fake.out)).toBe(false);
    expect((await readEvents(p.saDir)).filter((e) => e.type === "heartbeat")).toEqual([]);
  });

  it("refuses when the worktree does not have sa's hooks (settings not committed)", async () => {
    const p = await project({ commitSettings: false });
    const fake = await fakeClaude();
    const r = await sa(p.repo, fake.env, "worker", "start", "001");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/worktree for ticket 001 has no sa hooks in \.claude\/settings\.json/);
    expect(r.err).toMatch(/commit \.claude\/settings\.json/);
    expect(existsSync(fake.out)).toBe(false);
  });

  it("refuses a ticket that is not in progress", async () => {
    const p = await project();
    const r = await sa(p.repo, (await fakeClaude()).env, "worker", "start", "002");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Cannot start a worker for ticket 002: it is ready \(claim it first\)/);
  });

  it("exits 1 when claude cannot be found", async () => {
    const p = await project();
    const r = await sa(p.repo, { PATH: await tempDir() }, "worker", "start", "001");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/could not start claude/);
  });

  it("exits 2 for bad usage", async () => {
    const p = await project();
    expect((await sa(p.repo, {}, "worker", "start")).code).toBe(2);
    expect((await sa(p.repo, {}, "worker", "stop", "001")).code).toBe(2);
  });
});
