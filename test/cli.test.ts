import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { run, type Io } from "../src/app.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

function capture(): Io & { out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
    out: () => out,
    err: () => err,
  };
}

describe("sa run()", () => {
  it("prints the package version for --version and exits 0", async () => {
    const io = capture();
    const code = await run(["--version"], io);
    expect(code).toBe(0);
    expect(io.out().trim()).toBe(pkg.version);
    expect(io.err()).toBe("");
  });

  it("accepts -v as an alias for --version", async () => {
    const io = capture();
    expect(await run(["-v"], io)).toBe(0);
    expect(io.out().trim()).toBe(pkg.version);
  });

  it("prints usage to stdout for --help and exits 0", async () => {
    const io = capture();
    expect(await run(["--help"], io)).toBe(0);
    expect(io.out()).toMatch(/^Usage: sa <command>/);
  });

  it("prints usage to stderr and exits 2 when no command is given", async () => {
    const io = capture();
    expect(await run([], io)).toBe(2);
    expect(io.err()).toMatch(/^Usage: sa <command>/);
    expect(io.out()).toBe("");
  });

  it("names the unknown command, prints usage to stderr and exits 2", async () => {
    const io = capture();
    expect(await run(["frobnicate"], io)).toBe(2);
    expect(io.err()).toContain("Unknown command: frobnicate");
    expect(io.err()).toContain("Usage: sa <command>");
    expect(io.out()).toBe("");
  });
});
