import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApi } from "../helpers.js";

let api;
beforeEach(async () => {
  api = await startApi();
  for (const note of [
    { title: "Plan sprint", tags: ["work", "planning"] },
    { title: "Buy milk", tags: ["home"] },
    { title: "Fix bug", tags: ["work"] },
    { title: "Untagged" },
  ]) {
    await api.request("POST", "/api/notes", note);
  }
});
afterEach(async () => {
  await api.close();
});

const byTag = async (tag) => {
  const res = await api.request("GET", `/api/notes?tag=${encodeURIComponent(tag)}`);
  expect(res.status).toBe(200);
  return res.body.map((n) => n.title);
};

describe("003 filter by tag", () => {
  it("returns only notes with that tag, newest first", async () => {
    expect(await byTag("work")).toEqual(["Fix bug", "Plan sprint"]);
    expect(await byTag("home")).toEqual(["Buy milk"]);
  });

  it("cleans the tag the same way tags are stored (trim, lowercase)", async () => {
    expect(await byTag("  WORK ")).toEqual(["Fix bug", "Plan sprint"]);
  });

  it("matches whole tags only", async () => {
    expect(await byTag("plan")).toEqual([]);
    expect(await byTag("wor")).toEqual([]);
  });

  it("returns an empty list for an unknown tag", async () => {
    expect(await byTag("nope")).toEqual([]);
  });

  it("returns every note for an empty tag", async () => {
    expect(await byTag("")).toHaveLength(4);
  });

  it("returns each matching note's full data, tags included", async () => {
    const res = await api.request("GET", "/api/notes?tag=home");
    expect(res.body).toEqual([expect.objectContaining({ title: "Buy milk", tags: ["home"] })]);
  });
});
