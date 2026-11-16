import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../../src/app.js";
import type { Ticket } from "../../src/core/types.js";
import { captureIo, git, state, tempDir, tempProject, ticket, ticketIn } from "../helpers.js";

export const NOW = new Date("2026-11-16T20:00:00.000Z");

export const evalMd = (yaml: string) => `# Eval\n\n## Checks\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;

export const FEATURE_EVAL = `- id: C1
  type: command
  run: test -f feature.txt`;

/**
 * A project whose ticket 001 ("Add tags") is claimed by worker-1 via `sa claim`,
 * with eval.md written and (by default) feature.txt committed in the worktree.
 */
export async function claimedProject(
  yaml: string = FEATURE_EVAL,
  opts: { commitFeature?: boolean; extra?: Record<string, Ticket> } = {},
) {
  const p = await tempProject(
    state({
      "001": ticketIn("ready", { title: "Add tags" }),
      "002": ticketIn("ready", { title: "Other" }),
      "003": ticket(),
      ...opts.extra,
    }),
  );
  const dir = join(p.saDir, "tickets", "001-add-tags");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "eval.md"), evalMd(yaml));

  const io = captureIo();
  const ctx = { cwd: p.repo, now: () => NOW, env: {} };
  if ((await run(["claim", "001", "--agent", "worker-1", "--json"], io, ctx)) !== 0) throw new Error(io.err());
  const wt = (JSON.parse(io.out()) as { worktree: string }).worktree;

  if (opts.commitFeature ?? true) {
    await writeFile(join(wt, "feature.txt"), "done");
    git(wt, "add", "feature.txt");
    git(wt, "commit", "-q", "-m", "feat: add feature");
  }
  return { ...p, wt };
}

/** A bare repo added as `origin` of `repo`; returns its path. */
export async function bareOrigin(repo: string): Promise<string> {
  const remote = join(await tempDir(), "origin.git");
  git(await tempDir(), "init", "-q", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  return remote;
}

/** Ref → sha in a bare repo, or null. */
export function remoteRef(remote: string, ref: string): string | null {
  try {
    return git(remote, "rev-parse", "--verify", "--quiet", ref);
  } catch {
    return null;
  }
}

const FAKE_GH = `#!/bin/sh
# Fake gh for tests. Logs each call (one arg per line, then ---) to $FAKE_GH_LOG.
# Newlines inside an argument are stored as \\036 so multi-line bodies survive.
for a in "$@"; do printf '%s' "$a" | tr '\\n' '\\036' >> "$FAKE_GH_LOG"; echo >> "$FAKE_GH_LOG"; done
echo --- >> "$FAKE_GH_LOG"
if [ "$1 $2" = "pr list" ]; then
  [ -n "$FAKE_GH_EXISTING" ] && echo "$FAKE_GH_EXISTING"
  exit 0
fi
if [ "$1 $2" = "pr create" ]; then
  if [ -n "$FAKE_GH_FAIL" ]; then echo "$FAKE_GH_FAIL" >&2; exit 1; fi
  echo "Creating pull request..." >&2
  echo "https://github.com/o/r/pull/7"
  exit 0
fi
echo "fake gh: unexpected args: $*" >&2
exit 64
`;

export interface FakeGh {
  /** Env to pass in ctx.env so `gh` resolves to the fake. */
  env: Record<string, string>;
  /** Each call's argv. */
  calls: () => Promise<string[][]>;
}

export async function fakeGh(extraEnv: Record<string, string> = {}): Promise<FakeGh> {
  const bin = join(await tempDir(), "bin");
  await mkdir(bin);
  await writeFile(join(bin, "gh"), FAKE_GH);
  await chmod(join(bin, "gh"), 0o755);
  const log = join(bin, "calls.log");
  await writeFile(log, "");
  return {
    env: { PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_GH_LOG: log, ...extraEnv },
    calls: async () =>
      (await readFile(log, "utf8"))
        .split("---\n")
        .filter((c) => c.length)
        .map((c) => c.replace(/\n$/, "").split("\n").map((arg) => arg.replaceAll("\x1e", "\n"))),
  };
}
