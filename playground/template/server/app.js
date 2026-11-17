import { createServer } from "node:http";
import { createNote, listNotes, openDb } from "./db.js";

const MAX_BODY_BYTES = 64 * 1024;

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > MAX_BODY_BYTES) throw new Error("body too large");
  }
  return text ? JSON.parse(text) : {};
}

/**
 * The notes API as an http.Server (not listening yet).
 *   GET  /api/notes          -> 200 [note, ...] newest first
 *   POST /api/notes {title, body?} -> 201 note, or 400 {error}
 * A note is { id, title, body, createdAt }.
 */
export function createApp({ dbPath = ":memory:" } = {}) {
  const db = openDb(dbPath);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/api/notes" && req.method === "GET") {
        return send(res, 200, listNotes(db));
      }
      if (url.pathname === "/api/notes" && req.method === "POST") {
        let input;
        try {
          input = await readJson(req);
        } catch {
          return send(res, 400, { error: "invalid JSON" });
        }
        const title = typeof input.title === "string" ? input.title.trim() : "";
        if (!title) return send(res, 400, { error: "title is required" });
        const body = typeof input.body === "string" ? input.body : "";
        return send(res, 201, createNote(db, { title, body }));
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      return send(res, 500, { error: String(e?.message ?? e) });
    }
  });
  server.on("close", () => db.close());
  return server;
}
