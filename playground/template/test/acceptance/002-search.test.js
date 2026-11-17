import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApi } from "../helpers.js";

let api;
beforeEach(async () => {
  api = await startApi();
  for (const note of [
    { title: "Shopping list", body: "milk, eggs" },
    { title: "Work ideas", body: "Ship the Search feature" },
    { title: "Holiday", body: "Book flights" },
    { title: "Progress", body: "100% done, file_name kept" },
  ]) {
    await api.request("POST", "/api/notes", note);
  }
});
afterEach(async () => {
  await api.close();
});

const search = async (q) => {
  const res = await api.request("GET", `/api/notes?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return res.body.map((n) => n.title);
};

describe("002 search", () => {
  it("matches the body", async () => {
    expect(await search("milk")).toEqual(["Shopping list"]);
  });

  it("matches the title", async () => {
    expect(await search("ideas")).toEqual(["Work ideas"]);
  });

  it("ignores case", async () => {
    expect(await search("SEARCH")).toEqual(["Work ideas"]);
    expect(await search("holiday")).toEqual(["Holiday"]);
  });

  it("matches part of a word", async () => {
    expect(await search("ship")).toEqual(["Work ideas"]); // "Ship the Search feature"
  });

  it("keeps newest first when several notes match", async () => {
    expect(await search("o")).toEqual(["Progress", "Holiday", "Work ideas", "Shopping list"]);
  });

  it("returns every note for an empty or blank query", async () => {
    expect(await search("")).toHaveLength(4);
    expect(await search("   ")).toHaveLength(4);
  });

  it("returns an empty list when nothing matches", async () => {
    expect(await search("zebra")).toEqual([]);
  });

  it("treats % and _ as plain characters, not wildcards", async () => {
    expect(await search("%")).toEqual(["Progress"]);
    expect(await search("e_n")).toEqual(["Progress"]);
    expect(await search("_")).toEqual(["Progress"]);
  });

  it("trims the query", async () => {
    expect(await search("  milk  ")).toEqual(["Shopping list"]);
  });

  it("leaves GET /api/notes without q unchanged", async () => {
    expect((await api.request("GET", "/api/notes")).body).toHaveLength(4);
  });
});
