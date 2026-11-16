import { appendFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent, readEvents } from "../../src/core/events.js";
import type { SaEvent } from "../../src/core/types.js";
import { tempSaDir } from "../helpers.js";

const ev = (overrides: Partial<SaEvent> = {}): SaEvent => ({
  t: "2026-11-16T19:40:00.000Z",
  agent: "worker-1",
  ticket: "001",
  type: "heartbeat",
  ...overrides,
});

describe("appendEvent / readEvents", () => {
  it("reads back an empty list when no log exists yet", async () => {
    expect(await readEvents(await tempSaDir())).toEqual([]);
  });

  it("appends one JSON line per event, with extra fields kept", async () => {
    const dir = await tempSaDir();
    const e1 = ev({ type: "claim" });
    const e2 = ev({ type: "eval", result: "fail", failed: ["C2"] });
    await appendEvent(dir, e1);
    await appendEvent(dir, e2);
    const raw = await readFile(join(dir, "events.jsonl"), "utf8");
    expect(raw.split("\n")).toHaveLength(3); // two lines + trailing newline
    expect(await readEvents(dir)).toEqual([e1, e2]);
  });

  it("keeps all 50 lines intact under parallel appends", async () => {
    const dir = await tempSaDir();
    const events = Array.from({ length: 50 }, (_, i) =>
      ev({ agent: `worker-${i}`, note: "x".repeat(200) }),
    );
    await Promise.all(events.map((e) => appendEvent(dir, e)));
    const read = await readEvents(dir);
    expect(read).toHaveLength(50);
    expect(new Set(read.map((e) => e.agent)).size).toBe(50);
  });

  it.each([
    ["an unknown type", { type: "nap" }, /type: expected one of claim/],
    ["a bad timestamp", { t: "yesterday" }, /t: expected an ISO timestamp/],
    ["an empty agent", { agent: "" }, /agent: expected a non-empty string/],
    ["a bad ticket id", { ticket: "1" }, /ticket: expected a ticket id/],
  ])("rejects %s", async (_label, patch, pattern) => {
    const dir = await tempSaDir();
    const p = appendEvent(dir, { ...ev(), ...patch } as SaEvent);
    await expect(p).rejects.toMatchObject({ code: "INVALID_EVENT" });
    await expect(p).rejects.toThrow(pattern);
  });

  it("fails with NOT_INITIALIZED when .superagent/ is missing", async () => {
    const dir = await tempSaDir();
    await rm(dir, { recursive: true });
    await expect(appendEvent(dir, ev())).rejects.toMatchObject({ code: "NOT_INITIALIZED" });
  });

  it("skips a torn last line left by a crash mid-append", async () => {
    const dir = await tempSaDir();
    await appendEvent(dir, ev());
    await appendFile(join(dir, "events.jsonl"), '{"t":"2026-11-16T19:41');
    expect(await readEvents(dir)).toHaveLength(1);
  });

  it("fails with INVALID_EVENT on a corrupt line in the middle", async () => {
    const dir = await tempSaDir();
    await appendFile(join(dir, "events.jsonl"), "garbage\n");
    await appendEvent(dir, ev());
    await expect(readEvents(dir)).rejects.toThrow(/events\.jsonl line 1/);
  });
});
