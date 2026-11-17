import { afterEach, describe, expect, it } from "vitest";
import { startApi, tempDbPath } from "../helpers.js";

let api;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe("notes API (baseline)", () => {
  it("starts empty", async () => {
    api = await startApi();
    expect(await api.request("GET", "/api/notes")).toEqual({ status: 200, body: [] });
  });

  it("creates a note and lists it", async () => {
    api = await startApi();
    const created = await api.request("POST", "/api/notes", { title: "  Shopping ", body: "milk" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 1, title: "Shopping", body: "milk" });
    expect(typeof created.body.createdAt).toBe("string");
    expect((await api.request("GET", "/api/notes")).body).toEqual([created.body]);
  });

  it("lists newest first", async () => {
    api = await startApi();
    await api.request("POST", "/api/notes", { title: "first" });
    await api.request("POST", "/api/notes", { title: "second" });
    const titles = (await api.request("GET", "/api/notes")).body.map((n) => n.title);
    expect(titles).toEqual(["second", "first"]);
  });

  it("rejects a missing or blank title", async () => {
    api = await startApi();
    expect((await api.request("POST", "/api/notes", { body: "x" })).status).toBe(400);
    expect((await api.request("POST", "/api/notes", { title: "   " })).status).toBe(400);
  });

  it("keeps notes after a restart", async () => {
    const db = tempDbPath();
    try {
      api = await startApi({ dbPath: db.path });
      await api.request("POST", "/api/notes", { title: "kept" });
      await api.close();
      api = await startApi({ dbPath: db.path });
      expect((await api.request("GET", "/api/notes")).body.map((n) => n.title)).toEqual(["kept"]);
    } finally {
      await api?.close();
      api = undefined;
      db.cleanup();
    }
  });

  it("answers 404 for unknown routes", async () => {
    api = await startApi();
    expect((await api.request("GET", "/api/nope")).status).toBe(404);
  });
});
