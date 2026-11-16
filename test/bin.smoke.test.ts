import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Runs the built bin as a real process. test/global-setup.ts builds dist/ first.
const bin = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("dist/cli.js (built bin)", () => {
  it("prints the version and exits 0", () => {
    const out = execFileSync(process.execPath, [bin, "--version"], {
      encoding: "utf8",
    });
    expect(out.trim()).toBe(pkg.version);
  });

  it("exits 2 with usage on stderr for an unknown command", () => {
    const res = spawnSync(process.execPath, [bin, "nope"], { encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Unknown command: nope");
  });
});
