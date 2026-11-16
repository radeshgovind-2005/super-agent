import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { readEvents } from "../../src/core/events.js";
import { captureIo, state, tempProject, ticketIn } from "../helpers.js";

const NOW = new Date("2026-11-16T20:00:00.000Z");
const ctx = (repo: string, env: Record<string, string> = {}) => ({ cwd: repo, now: () => NOW, env });

async function project() {
  return tempProject(state({ "001": ticketIn("in_progress", { title: "Add tags" }) }));
}

describe("sa event", () => {
  it("appends one event stamped with the clock, agent and payload", async () => {
    const { repo, saDir } = await project();
    const io = captureIo();
    const code = await run(["event", "001", "question", '{"text":"Which DB?"}', "--agent", "worker-1"], io, ctx(repo));
    expect(code).toBe(0);
    expect(io.out()).toBe("");
    expect(await readEvents(saDir)).toEqual([
      { t: "2026-11-16T20:00:00.000Z", agent: "worker-1", ticket: "001", type: "question", text: "Which DB?" },
    ]);
  });

  it("works without a payload", async () => {
    const { repo, saDir } = await project();
    expect(await run(["event", "001", "heartbeat", "--agent", "worker-1"], captureIo(), ctx(repo))).toBe(0);
    expect(await readEvents(saDir)).toHaveLength(1);
  });

  it("takes the agent from SA_AGENT when --agent is missing", async () => {
    const { repo, saDir } = await project();
    expect(await run(["event", "001", "heartbeat"], captureIo(), ctx(repo, { SA_AGENT: "worker-7" }))).toBe(0);
    expect((await readEvents(saDir))[0]?.agent).toBe("worker-7");
  });

  it("never changes state.json", async () => {
    const { repo, saDir } = await project();
    const before = await readFile(join(saDir, "state.json"), "utf8");
    await run(["event", "001", "blocked", '{"reason":"needs keys"}', "--agent", "worker-1"], captureIo(), ctx(repo));
    expect(await readFile(join(saDir, "state.json"), "utf8")).toBe(before);
  });

  it.each([
    ["an unknown ticket", ["event", "009", "heartbeat"], /Unknown ticket 009/],
    ["an unknown type", ["event", "001", "nap"], /type: expected one of/],
    ["a type only sa may write (claim)", ["event", "001", "claim"], /sa writes claim events itself/],
    ["a type only sa may write (eval)", ["event", "001", "eval", '{"result":"pass"}'], /sa writes eval events itself/],
    ["a type only sa may write (pr_opened)", ["event", "001", "pr_opened"], /sa writes pr_opened events itself/],
    ["a payload that is not JSON", ["event", "001", "question", "{nope"], /payload is not valid JSON/],
    ["a payload that is not an object", ["event", "001", "question", "[1,2]"], /payload must be a JSON object/],
    ["a payload that sets a reserved field", ["event", "001", "question", '{"agent":"router"}'], /payload may not set agent/],
  ])("exits 1 and writes nothing for %s", async (_label, argv, pattern) => {
    const { repo, saDir } = await project();
    const io = captureIo();
    expect(await run([...argv, "--agent", "worker-1"], io, ctx(repo))).toBe(1);
    expect(io.err()).toMatch(pattern);
    expect(await readEvents(saDir)).toEqual([]);
  });

  it.each([
    ["no agent", ["event", "001", "heartbeat"], /--agent/],
    ["no type", ["event", "001", "--agent", "w"], /Usage: sa event/],
    ["a bad agent name", ["event", "001", "heartbeat", "--agent", "worker 1"], /agent name/],
    ["too many arguments", ["event", "001", "heartbeat", "{}", "extra", "--agent", "w"], /Usage: sa event/],
  ])("exits 2 for %s", async (_label, argv, pattern) => {
    const { repo, saDir } = await project();
    const io = captureIo();
    expect(await run(argv, io, ctx(repo))).toBe(2);
    expect(io.err()).toMatch(pattern);
    expect(await readEvents(saDir)).toEqual([]);
  });
});
