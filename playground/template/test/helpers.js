import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";

/** Start the API on a free port. Returns { url, request, close }. */
export async function startApi({ dbPath = ":memory:" } = {}) {
  const server = createApp({ dbPath });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    /** fetch + JSON: request("GET", "/api/notes"), request("POST", "/api/notes", {...}) */
    async request(method, path, body) {
      const res = await fetch(url + path, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** A temp folder for a database file that must survive an API restart. */
export function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "notes-"));
  return { path: join(dir, "notes.db"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
