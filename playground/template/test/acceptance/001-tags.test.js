import { afterEach, describe, expect, it } from "vitest";
import { renderNote } from "../../src/render.js";
import { fakeDocument } from "../fake-dom.js";
import { startApi, tempDbPath } from "../helpers.js";

let api;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const post = (body) => api.request("POST", "/api/notes", body);
const tagsOf = async () => (await api.request("GET", "/api/notes")).body.map((n) => n.tags);

describe("001 tags: API", () => {
  it("stores cleaned tags: trimmed, lowercase, no empties, no duplicates, order kept", async () => {
    api = await startApi();
    const res = await post({ title: "Plan", tags: [" Work", "work", "", "  ", "Ideas ", "WORK"] });
    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual(["work", "ideas"]);
    expect(await tagsOf()).toEqual([["work", "ideas"]]);
  });

  it("gives notes without tags an empty list", async () => {
    api = await startApi();
    expect((await post({ title: "Plain" })).body.tags).toEqual([]);
    expect(await tagsOf()).toEqual([[]]);
  });

  it("accepts exactly 10 tags and rejects 11", async () => {
    api = await startApi();
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect((await post({ title: "Ten", tags: ten })).status).toBe(201);
    const eleven = await post({ title: "Eleven", tags: [...ten, "t10"] });
    expect(eleven.status).toBe(400);
    expect(typeof eleven.body.error).toBe("string");
  });

  it("counts the limit after removing duplicates", async () => {
    api = await startApi();
    const tags = [...Array.from({ length: 10 }, (_, i) => `t${i}`), "T0", " t1 "];
    expect((await post({ title: "Dupes", tags })).status).toBe(201);
  });

  it("rejects a tag longer than 20 characters", async () => {
    api = await startApi();
    expect((await post({ title: "Ok", tags: ["a".repeat(20)] })).status).toBe(201);
    expect((await post({ title: "Long", tags: ["a".repeat(21)] })).status).toBe(400);
  });

  it.each([["a string", "work"], ["numbers", [1, 2]], ["null", null], ["an object", { a: 1 }]])(
    "rejects tags that are %s",
    async (_label, tags) => {
      api = await startApi();
      const res = await post({ title: "Bad", tags });
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(await tagsOf()).toEqual([]);
    },
  );

  it("keeps tags after a restart", async () => {
    const db = tempDbPath();
    try {
      api = await startApi({ dbPath: db.path });
      await post({ title: "Kept", tags: ["home"] });
      await api.close();
      api = await startApi({ dbPath: db.path });
      expect(await tagsOf()).toEqual([["home"]]);
    } finally {
      await api?.close();
      api = undefined;
      db.cleanup();
    }
  });

  it("supports emoji and accents in tags", async () => {
    api = await startApi();
    expect((await post({ title: "Fun", tags: ["🎉 Party", "Café"] })).body.tags).toEqual(["🎉 party", "café"]);
  });
});

describe("001 tags: UI", () => {
  it("renders one .tag element per tag, with the tag as its text", () => {
    const li = renderNote(fakeDocument, { id: 1, title: "T", body: "", createdAt: "", tags: ["work", "ideas"] });
    expect(li.findByClass("tag").map((el) => el.textContent)).toEqual(["work", "ideas"]);
  });

  it("renders no .tag elements for a note without tags", () => {
    const li = renderNote(fakeDocument, { id: 1, title: "T", body: "", createdAt: "", tags: [] });
    expect(li.findByClass("tag")).toEqual([]);
  });
});
