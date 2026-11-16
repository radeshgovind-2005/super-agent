import { randomUUID } from "node:crypto";
import { open, rename as fsRename, rm } from "node:fs/promises";

export interface AtomicWriteOptions {
  /** Injected in tests to simulate a crash between writing and renaming. */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Write to a temp file in the same directory, fsync it, then rename over the target.
 * Readers see either the old file or the new one, never a half-written file.
 */
export async function writeFileAtomic(path: string, data: string, opts: AtomicWriteOptions = {}): Promise<void> {
  const rename = opts.rename ?? fsRename;
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tmp, "wx");
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
