import { defineConfig } from "vitest/config";

// `npm run test:acceptance -- <ticket>`: the hidden-goal tests each ticket's eval runs.
// Workers may not edit these files (sa's guard hook blocks it).
export default defineConfig({
  test: { include: ["test/acceptance/**/*.test.js"], environment: "node" },
});
