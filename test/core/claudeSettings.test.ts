import { describe, expect, it } from "vitest";
import { DENY_RULES, mergeSettings } from "../../src/core/claudeSettings.js";
import { SaError } from "../../src/core/errors.js";

const ours = (saCommand = "sa") => mergeSettings({}, saCommand).settings as Record<string, any>;

describe("mergeSettings", () => {
  it("adds the hooks and deny rules to empty settings", () => {
    const s = ours();
    expect(s.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "sa hook stop", timeout: 1800 }] }]);
    expect(s.hooks.SubagentStop).toEqual(s.hooks.Stop);
    expect(s.hooks.PreToolUse).toEqual([
      {
        matcher: "Read|Write|Edit|MultiEdit|NotebookEdit|Grep|Bash",
        hooks: [{ type: "command", command: "sa hook pre-tool-use", timeout: 30 }],
      },
    ]);
    expect(s.permissions.deny).toEqual(DENY_RULES);
  });

  it("denies secrets, pushes to main, merges, rm -rf, and edits to sa state", () => {
    for (const rule of [
      "Read(**/.env)",
      "Read(**/*.pem)",
      "Read(~/.ssh/**)",
      "Bash(git push * main)",
      "Bash(git push *:main)",
      "Bash(git push * master)",
      "Bash(gh pr merge *)",
      "Bash(rm -rf *)",
      "Edit(**/.superagent/state.json)",
      "Edit(**/.superagent/events.jsonl)",
    ]) {
      expect(DENY_RULES).toContain(rule);
    }
  });

  it("uses a custom sa command", () => {
    const s = ours('node "/opt/super-agent/dist/cli.js"');
    expect(s.hooks.Stop[0].hooks[0].command).toBe('node "/opt/super-agent/dist/cli.js" hook stop');
  });

  it("keeps the user's other settings, hooks and rules", () => {
    const existing = {
      model: "opus",
      permissions: { allow: ["Bash(npm test *)"], deny: ["Read(./private/**)", "Bash(git push * main)"] },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "prettier --write" }] }],
      },
    };
    const { settings, changed } = mergeSettings(existing, "sa");
    const s = settings as Record<string, any>;
    expect(changed).toBe(true);
    expect(s.model).toBe("opus");
    expect(s.permissions.allow[0]).toBe("Bash(npm test *)"); // user's rule kept first
    expect(s.permissions.allow).toContain("Bash(sa *)");
    expect(s.permissions.deny[0]).toBe("Read(./private/**)");
    expect(s.permissions.deny.filter((r: string) => r === "Bash(git push * main)")).toHaveLength(1);
    expect(s.hooks.PostToolUse).toEqual(existing.hooks.PostToolUse);
    expect(s.hooks.Stop).toEqual([
      { hooks: [{ type: "command", command: "say done" }] },
      { hooks: [{ type: "command", command: "sa hook stop", timeout: 1800 }] },
    ]);
  });

  it("is idempotent", () => {
    const once = mergeSettings({}, "sa").settings;
    const twice = mergeSettings(JSON.parse(JSON.stringify(once)), "sa");
    expect(twice.changed).toBe(false);
    expect(twice.settings).toEqual(once);
  });

  it("replaces an older sa hook (e.g. a different sa command) instead of adding a second", () => {
    const old = mergeSettings({}, "node /old/cli.js").settings;
    const s = mergeSettings(old, "sa").settings as Record<string, any>;
    expect(s.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "sa hook stop", timeout: 1800 }] }]);
    expect(s.hooks.PreToolUse).toHaveLength(1);
  });

  it("does not mistake a user hook that only mentions sa for ours", () => {
    const existing = { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo 'sa hook stop ran'" }] }] } };
    const s = mergeSettings(existing, "sa").settings as Record<string, any>;
    expect(s.hooks.Stop).toHaveLength(2);
  });

  it.each([
    ["an array", []],
    ["a string", "x"],
    ["permissions that is not an object", { permissions: [] }],
    ["deny that is not a list", { permissions: { deny: "Read(.env)" } }],
    ["hooks that is not an object", { hooks: [] }],
    ["an event that is not a list", { hooks: { Stop: {} } }],
  ])("refuses %s", (_label, existing) => {
    expect(() => mergeSettings(existing, "sa")).toThrow(SaError);
  });
});
