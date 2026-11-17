import { mkdirSync } from "node:fs";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
mkdirSync("data", { recursive: true });
createApp({ dbPath: process.env.DB_PATH ?? "data/notes.db" }).listen(port, () => {
  console.log(`notes API on http://localhost:${port}`);
});
