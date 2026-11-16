import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Name + size + mtime of every file under dir, to prove a command wrote nothing. */
export async function snapshotFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
  const rows = await Promise.all(
    files.map(async (f) => {
      const s = await stat(f);
      return `${f} ${s.size} ${s.mtimeMs}`;
    }),
  );
  return rows.sort();
}
