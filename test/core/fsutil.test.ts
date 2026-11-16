import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeFileAtomic } from "../../src/core/fsutil.js";
import { tempDir } from "../helpers.js";

describe("writeFileAtomic", () => {
  it("creates and replaces a file", async () => {
    const dir = await tempDir();
    const file = join(dir, "f.json");
    await writeFileAtomic(file, "one");
    await writeFileAtomic(file, "two");
    expect(await readFile(file, "utf8")).toBe("two");
    expect(await readdir(dir)).toEqual(["f.json"]);
  });

  it("keeps the old content and cleans up when the final rename fails (simulated crash)", async () => {
    const dir = await tempDir();
    const file = join(dir, "f.json");
    await writeFile(file, "old");
    const crash = async (): Promise<void> => {
      throw new Error("crash before rename");
    };
    await expect(writeFileAtomic(file, "new", { rename: crash })).rejects.toThrow("crash before rename");
    expect(await readFile(file, "utf8")).toBe("old");
    expect(await readdir(dir)).toEqual(["f.json"]);
  });
});
