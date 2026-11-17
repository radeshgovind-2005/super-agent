import { DatabaseSync } from "node:sqlite";

/** Open (or create) the notes database at `path` (":memory:" for tests). */
export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      body       TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL
    );
  `);
  return db;
}

const toNote = (row) => ({ id: row.id, title: row.title, body: row.body, createdAt: row.created_at });

/** All notes, newest first. */
export function listNotes(db) {
  return db.prepare("SELECT * FROM notes ORDER BY id DESC").all().map(toNote);
}

export function createNote(db, { title, body = "" }) {
  const createdAt = new Date().toISOString();
  const { lastInsertRowid } = db
    .prepare("INSERT INTO notes (title, body, created_at) VALUES (?, ?, ?)")
    .run(title, body, createdAt);
  return toNote(db.prepare("SELECT * FROM notes WHERE id = ?").get(Number(lastInsertRowid)));
}
