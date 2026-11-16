import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SaError } from "../../src/core/errors.js";
import { loadState, parseState, saveState, updateState } from "../../src/core/state.js";
import { state, tempSaDir, ticket, ticketIn } from "../helpers.js";

function invalid(raw: unknown): string {
  try {
    parseState(raw);
  } catch (e) {
    if (e instanceof SaError && e.code === "INVALID_STATE") return e.message;
    throw e;
  }
  throw new Error("expected INVALID_STATE");
}

describe("parseState", () => {
  it("accepts a valid state and returns an equal copy", () => {
    const s = state({ "001": ticketIn("in_progress"), "002": ticket({ dependsOn: ["001"] }) });
    const parsed = parseState(JSON.parse(JSON.stringify(s)));
    expect(parsed).toEqual(s);
  });

  it("rejects a non-object", () => {
    expect(invalid(null)).toMatch(/state: expected an object/);
  });

  it("rejects an unknown version", () => {
    expect(invalid({ ...state(), version: 2 })).toMatch(/version: expected 1/);
  });

  it("rejects an unknown status and names the field path", () => {
    const raw = state({ "001": ticket() }) as unknown as { tickets: Record<string, Record<string, unknown>> };
    raw.tickets["001"]!.status = "doing";
    expect(invalid(raw)).toMatch(/tickets\.001\.status: expected one of draft, ready/);
  });

  it("rejects a dependency on a ticket that does not exist", () => {
    expect(invalid(state({ "001": ticket({ dependsOn: ["009"] }) }))).toMatch(
      /tickets\.001\.dependsOn: unknown ticket 009/,
    );
  });

  it("rejects a ticket that depends on itself", () => {
    expect(invalid(state({ "001": ticket({ dependsOn: ["001"] }) }))).toMatch(/depends on itself/);
  });

  it("rejects a bad ticket id", () => {
    expect(invalid(state({ "1": ticket() }))).toMatch(/tickets\.1: ticket id must be 3\+ digits/);
  });

  it("rejects maxWorkers below 1", () => {
    expect(invalid(state({}, { maxWorkers: 0 }))).toMatch(/run\.maxWorkers: expected an integer >= 1/);
  });

  it("requires owner, branch and worktree while in_progress", () => {
    const msg = invalid(state({ "001": ticketIn("in_progress", { owner: null, worktree: null }) }));
    expect(msg).toMatch(/tickets\.001\.owner: required while in_progress/);
    expect(msg).toMatch(/tickets\.001\.worktree: required while in_progress/);
  });

  it("requires a pr while in review", () => {
    expect(invalid(state({ "001": ticketIn("review", { pr: null }) }))).toMatch(
      /tickets\.001\.pr: required while review/,
    );
  });

  it("reports every problem at once", () => {
    const raw = { version: 1, run: { id: "", budgetTokens: -1, maxWorkers: 2 }, tickets: {} };
    const msg = invalid(raw);
    expect(msg).toMatch(/run\.id/);
    expect(msg).toMatch(/run\.budgetTokens/);
  });
});

describe("loadState", () => {
  it("fails with NOT_INITIALIZED when state.json is missing", async () => {
    const dir = await tempSaDir();
    await expect(loadState(dir)).rejects.toMatchObject({ code: "NOT_INITIALIZED" });
  });

  it("fails with INVALID_STATE on malformed JSON", async () => {
    const dir = await tempSaDir();
    await writeFile(join(dir, "state.json"), "{ nope");
    await expect(loadState(dir)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("saveState", () => {
  it("round-trips through loadState", async () => {
    const dir = await tempSaDir();
    const s = state({ "001": ticket({ title: "Add tags field" }) });
    await saveState(dir, s);
    expect(await loadState(dir)).toEqual(s);
  });

  it("rewrites tickets/board.md on every save", async () => {
    const dir = await tempSaDir();
    await saveState(dir, state({ "001": ticket({ title: "First" }) }));
    expect(await readFile(join(dir, "tickets", "board.md"), "utf8")).toContain("First");
    await saveState(dir, state({ "001": ticket({ title: "Second" }) }));
    const board = await readFile(join(dir, "tickets", "board.md"), "utf8");
    expect(board).toContain("Second");
    expect(board).not.toContain("First");
  });

  it("refuses to write an invalid state and leaves the old file alone", async () => {
    const dir = await tempSaDir();
    const good = state({ "001": ticket() });
    await saveState(dir, good);
    await expect(saveState(dir, state({ "001": ticket({ dependsOn: ["404"] }) }))).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(await loadState(dir)).toEqual(good);
  });

  it("leaves no temp files behind", async () => {
    const dir = await tempSaDir();
    await saveState(dir, state());
    expect((await readdir(dir)).sort()).toEqual(["state.json", "tickets"]);
  });
});

describe("updateState", () => {
  it("applies the change, saves it, and returns the new state", async () => {
    const dir = await tempSaDir();
    await saveState(dir, state({ "001": ticket() }));
    const next = await updateState(dir, (s) => ({
      ...s,
      tickets: { ...s.tickets, "001": { ...s.tickets["001"]!, title: "Renamed" } },
    }));
    expect(next.tickets["001"]?.title).toBe("Renamed");
    expect((await loadState(dir)).tickets["001"]?.title).toBe("Renamed");
  });

  it("does not save when the change function throws", async () => {
    const dir = await tempSaDir();
    const s = state({ "001": ticket() });
    await saveState(dir, s);
    await expect(
      updateState(dir, () => {
        throw new SaError("ILLEGAL_TRANSITION", "nope");
      }),
    ).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
    expect(await loadState(dir)).toEqual(s);
    expect(await readdir(dir)).not.toContain("state.lock");
  });

  it("serialises 20 parallel updates so none is lost", async () => {
    const dir = await tempSaDir();
    await saveState(dir, state({ "001": ticket() }));
    await Promise.all(
      Array.from({ length: 20 }, () =>
        updateState(dir, (s) => ({
          ...s,
          tickets: { ...s.tickets, "001": { ...s.tickets["001"]!, attempts: s.tickets["001"]!.attempts + 1 } },
        })),
      ),
    );
    expect((await loadState(dir)).tickets["001"]?.attempts).toBe(20);
  });
});
