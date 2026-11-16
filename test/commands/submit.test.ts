import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { readEvents } from "../../src/core/events.js";
import { loadState, updateState } from "../../src/core/state.js";
import { captureIo, git, tempProject, state, ticketIn } from "../helpers.js";
import { NOW, bareOrigin, claimedProject, fakeGh, remoteRef, type FakeGh } from "./fixtures.js";

const PR = "https://github.com/o/r/pull/7";
const BRANCH = "sa/001-add-tags";

async function sa(cwd: string, gh: FakeGh, ...argv: string[]) {
  const io = captureIo();
  const code = await run(argv, io, { cwd, now: () => NOW, env: gh.env });
  return { code, out: io.out(), err: io.err() };
}

/** Claimed ticket 001 with feature committed, a bare origin, a fake gh, and (by default) a passing eval. */
async function ready(opts: { evalFirst?: boolean; ghEnv?: Record<string, string> } = {}) {
  const p = await claimedProject();
  const remote = await bareOrigin(p.repo);
  const gh = await fakeGh(opts.ghEnv);
  if (opts.evalFirst ?? true) {
    const r = await sa(p.repo, gh, "eval", "001");
    if (r.code !== 0) throw new Error(r.out + r.err);
  }
  return { ...p, remote, gh };
}

async function expectNothingSubmitted(p: Awaited<ReturnType<typeof ready>>) {
  expect(remoteRef(p.remote, `refs/heads/${BRANCH}`)).toBeNull();
  expect((await p.gh.calls()).filter((c) => c[1] === "create")).toEqual([]);
  expect((await loadState(p.saDir)).tickets["001"]).toMatchObject({ status: "in_progress", pr: null });
  expect((await readEvents(p.saDir)).filter((e) => e.type === "pr_opened")).toEqual([]);
}

describe("sa submit", () => {
  it("pushes the evaluated commit, opens the PR, and moves the ticket to review", async () => {
    const p = await ready();
    const head = git(p.wt, "rev-parse", "HEAD");
    const r = await sa(p.repo, p.gh, "submit", "001");

    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toBe(`Submitted 001: ${PR}\n`);

    expect(remoteRef(p.remote, `refs/heads/${BRANCH}`)).toBe(head);
    expect(remoteRef(p.remote, "refs/heads/main")).toBeNull(); // never pushes main

    const create = (await p.gh.calls()).find((c) => c[1] === "create")!;
    expect(create).toEqual(expect.arrayContaining(["--base", "main", "--head", BRANCH, "--title", "feat(001): add tags"]));
    const body = create[create.indexOf("--body") + 1];
    expect(body).toContain("Ticket 001: Add tags");
    expect(body).toContain(`Eval: PASS on ${head.slice(0, 7)}`);
    expect(body).toContain(".superagent/tickets/001-add-tags/spec.md");

    expect((await loadState(p.saDir)).tickets["001"]).toMatchObject({ status: "review", pr: PR, owner: null });
    expect(await readEvents(p.saDir)).toContainEqual({
      t: NOW.toISOString(),
      agent: "worker-1",
      ticket: "001",
      type: "pr_opened",
      pr: PR,
      branch: BRANCH,
      commit: head,
    });
  });

  it("works from inside the worktree and supports --json, --base and --title", async () => {
    const p = await ready();
    const r = await sa(p.wt, p.gh, "submit", "001", "--json", "--base", "develop", "--title", "feat: tags on notes");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      id: "001",
      pr: PR,
      branch: BRANCH,
      commit: git(p.wt, "rev-parse", "HEAD"),
      created: true,
    });
    const create = (await p.gh.calls()).find((c) => c[1] === "create")!;
    expect(create).toEqual(expect.arrayContaining(["--base", "develop", "--title", "feat: tags on notes"]));
  });

  it("reuses an open PR for the branch instead of creating another", async () => {
    const p = await ready({ ghEnv: { FAKE_GH_EXISTING: "https://github.com/o/r/pull/3" } });
    const r = await sa(p.repo, p.gh, "submit", "001", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ pr: "https://github.com/o/r/pull/3", created: false });
    expect((await p.gh.calls()).filter((c) => c[1] === "create")).toEqual([]);
  });

  it("refuses without an eval, pushing nothing", async () => {
    const p = await ready({ evalFirst: false });
    const r = await sa(p.repo, p.gh, "submit", "001");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/its last eval has not passed/);
    await expectNothingSubmitted(p);
  });

  it("refuses after a failed eval", async () => {
    const p = await ready({ evalFirst: false });
    await writeFile(join(p.saDir, "tickets", "001-add-tags", "eval.md"), "## Checks\n\n```yaml\n- {id: C1, type: command, run: 'exit 1'}\n```\n");
    expect((await sa(p.repo, p.gh, "eval", "001")).code).toBe(1);
    expect((await sa(p.repo, p.gh, "submit", "001")).code).toBe(1);
    await expectNothingSubmitted(p);
  });

  it("refuses when HEAD moved after the passing eval", async () => {
    const p = await ready();
    await writeFile(join(p.wt, "more.txt"), "x");
    git(p.wt, "add", "more.txt");
    git(p.wt, "commit", "-q", "-m", "feat: more");
    const r = await sa(p.repo, p.gh, "submit", "001");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Run the eval again/);
    await expectNothingSubmitted(p);
  });

  it("refuses when the worktree is on a different branch", async () => {
    const p = await ready();
    git(p.wt, "checkout", "-q", "-b", "other");
    const r = await sa(p.repo, p.gh, "submit", "001");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/worktree for ticket 001 is on other, expected sa\/001-add-tags/);
    await expectNothingSubmitted(p);
  });

  it("refuses a ticket whose branch is not an sa/ branch (never pushes main)", async () => {
    const { repo, saDir } = await tempProject(state({ "001": ticketIn("ready") }));
    const remote = await bareOrigin(repo);
    const gh = await fakeGh();
    const head = git(repo, "rev-parse", "HEAD");
    await updateState(saDir, (s) => ({
      ...s,
      tickets: {
        "001": ticketIn("in_progress", {
          branch: "main",
          worktree: ".",
          lastEval: { result: "pass", at: NOW.toISOString(), failed: [], commit: head },
        }),
      },
    }));
    const r = await sa(repo, gh, "submit", "001");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/refusing to push main: sa only pushes sa\/ branches/);
    expect(remoteRef(remote, "refs/heads/main")).toBeNull();
    expect(await gh.calls()).toEqual([]);
  });

  it("stays in progress when gh fails, and a rerun finishes the job", async () => {
    const p = await ready({ ghEnv: { FAKE_GH_FAIL: "HTTP 401: Bad credentials" } });
    const head = git(p.wt, "rev-parse", "HEAD");

    const first = await sa(p.repo, p.gh, "submit", "001");
    expect(first.code).toBe(1);
    expect(first.err).toMatch(/gh pr create failed: HTTP 401: Bad credentials/);
    expect(remoteRef(p.remote, `refs/heads/${BRANCH}`)).toBe(head); // pushed already: fine
    expect((await loadState(p.saDir)).tickets["001"]).toMatchObject({ status: "in_progress", pr: null });
    expect((await readEvents(p.saDir)).filter((e) => e.type === "pr_opened")).toEqual([]);

    const fixed = { ...p.gh, env: { ...p.gh.env, FAKE_GH_FAIL: "" } };
    const second = await sa(p.repo, fixed, "submit", "001");
    expect(second.code).toBe(0);
    expect((await loadState(p.saDir)).tickets["001"]).toMatchObject({ status: "review", pr: PR });
  });

  it("exits 1 when the push fails, before calling gh", async () => {
    const p = await ready();
    git(p.repo, "remote", "set-url", "origin", join(p.remote, "missing"));
    const r = await sa(p.repo, p.gh, "submit", "001");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^sa: git push failed/);
    expect(await p.gh.calls()).toEqual([]);
    expect((await loadState(p.saDir)).tickets["001"]?.status).toBe("in_progress");
  });

  it("exits 1 for a ticket that is not in progress, 2 without an id", async () => {
    const p = await ready();
    const r = await sa(p.repo, p.gh, "submit", "002");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Cannot submit ticket 002: it is ready/);
    expect((await sa(p.repo, p.gh, "submit")).code).toBe(2);
  });
});
