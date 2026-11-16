import { describe, expect, it } from "vitest";
import { decide, type GuardContext } from "../../src/hooks/guard.js";

const REPO = "/work/repo";
const WT = "/work/.sa-worktrees/repo/001";

const router: GuardContext = { cwd: REPO, branch: "main", worker: null };
const worker: GuardContext = {
  cwd: WT,
  branch: "sa/001-add-tags",
  worker: { id: "001", worktree: WT, protectedFiles: [`${WT}/test/tags.test.ts`] },
};

const bash = (command: string) => ({ toolName: "Bash", toolInput: { command } });
const file = (toolName: string, file_path: string) => ({ toolName, toolInput: { file_path } });

describe("secrets", () => {
  it.each([
    ["Read", "/work/repo/.env"],
    ["Read", ".env.local"],
    ["Read", "config/.env.production"],
    ["Read", "/home/me/.ssh/id_rsa"],
    ["Read", "id_ed25519.pub"],
    ["Read", "certs/server.pem"],
    ["Read", "secrets/api.key"],
    ["Edit", ".env"],
    ["Write", ".env"],
  ])("%s %s is blocked", (tool, path) => {
    expect(decide(file(tool, path), router)).toMatch(/secret/);
  });

  it.each([
    ["Read", ".env.example"],
    ["Read", ".env.sample"],
    ["Read", ".env.template"],
    ["Read", "src/envelope.ts"],
    ["Read", "src/keyboard.ts"],
    ["Read", "docs/environment.md"],
  ])("%s %s is allowed", (tool, path) => {
    expect(decide(file(tool, path), router)).toBeNull();
  });

  it.each(["cat .env", "source .env.local && npm start", "grep API_KEY config/.env", "less ~/.ssh/id_rsa", "cat <.env"])(
    "Bash %j is blocked",
    (cmd) => {
      expect(decide(bash(cmd), router)).toMatch(/secret/);
    },
  );

  it.each(["echo $ENV", "ls -la", "cat .env.example", "node scripts/env-check.js"])("Bash %j is allowed", (cmd) => {
    expect(decide(bash(cmd), router)).toBeNull();
  });

  it("blocks Grep in a secret file or with a secret glob", () => {
    expect(decide({ toolName: "Grep", toolInput: { pattern: "KEY", path: ".env" } }, router)).toMatch(/secret/);
    expect(decide({ toolName: "Grep", toolInput: { pattern: "KEY", glob: ".env*" } }, router)).toMatch(/secret/);
    expect(decide({ toolName: "Grep", toolInput: { pattern: "KEY", path: "src" } }, router)).toBeNull();
  });
});

describe("pushing to main and merging", () => {
  it.each([
    "git push origin main",
    "git push origin master",
    "git push -f origin main",
    "git push origin HEAD:main",
    "git push origin sa/001:refs/heads/main",
    "cd sub && git push origin main",
    "git -C /work/repo push origin main",
    "gh pr merge 3 --squash",
  ])("%j is blocked", (cmd) => {
    expect(decide(bash(cmd), worker)).toMatch(/main|merge/);
  });

  it("blocks a bare `git push` while on main", () => {
    expect(decide(bash("git push"), router)).toMatch(/main/);
  });

  it.each(["git push", "git push origin sa/001-add-tags", "git push origin main-feature", "git status", "echo main"])(
    "%j is allowed on a ticket branch",
    (cmd) => {
      expect(decide(bash(cmd), worker)).toBeNull();
    },
  );
});

describe("sa state files", () => {
  it.each([".superagent/state.json", "/work/repo/.superagent/events.jsonl", ".superagent/tickets/board.md"])(
    "editing %s is blocked for everyone",
    (path) => {
      expect(decide(file("Write", path), router)).toMatch(/only sa writes/);
      expect(decide(file("Edit", path), worker)).toMatch(/only sa writes/);
    },
  );

  it("allows reading them", () => {
    expect(decide(file("Read", ".superagent/state.json"), router)).toBeNull();
    expect(decide(bash("cat .superagent/state.json"), router)).toBeNull();
  });

  it("blocks shell writes to them", () => {
    expect(decide(bash("echo '{}' > .superagent/state.json"), router)).toMatch(/only sa writes/);
    expect(decide(bash("rm .superagent/events.jsonl"), router)).toMatch(/only sa writes/);
  });
});

describe("eval files (workers only)", () => {
  it.each([
    ["Edit", `${WT}/.superagent/tickets/001-add-tags/eval.md`],
    ["Write", "/work/repo/.superagent/tickets/001-add-tags/eval.md"],
    ["Edit", `${WT}/test/tags.test.ts`],
    ["Write", "test/tags.test.ts"],
    ["NotebookEdit", `${WT}/test/tags.test.ts`],
  ])("a worker's %s of %s is blocked", (tool, path) => {
    const input =
      tool === "NotebookEdit" ? { toolName: tool, toolInput: { notebook_path: path } } : file(tool, path);
    expect(decide(input, worker)).toMatch(/eval/);
  });

  it("lets a worker read them and edit other files", () => {
    expect(decide(file("Read", `${WT}/test/tags.test.ts`), worker)).toBeNull();
    expect(decide(file("Edit", `${WT}/src/tags.ts`), worker)).toBeNull();
    expect(decide(file("Edit", `${WT}/test/other.test.ts`), worker)).toBeNull();
  });

  it.each(["sed -i '' s/a/b/ test/tags.test.ts", "rm test/tags.test.ts", "echo x >> .superagent/tickets/001-add-tags/eval.md"])(
    "blocks the shell write %j",
    (cmd) => {
      expect(decide(bash(cmd), worker)).toMatch(/eval/);
    },
  );

  it.each(["cat test/tags.test.ts", "npm test -- tags", "git diff test/tags.test.ts"])("allows %j", (cmd) => {
    expect(decide(bash(cmd), worker)).toBeNull();
  });

  it("lets the router (not a worker) write eval.md while planning", () => {
    expect(decide(file("Write", "/work/repo/.superagent/tickets/001-add-tags/eval.md"), router)).toBeNull();
  });
});

describe("other tools", () => {
  it("allows tools it does not know", () => {
    expect(decide({ toolName: "WebSearch", toolInput: { query: ".env" } }, router)).toBeNull();
  });
});
