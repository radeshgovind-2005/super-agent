import { defineConfig } from "vitest/config";

// `npm test`: the app's own tests. Acceptance tests (one file per ticket) have
// their own config, so tickets that are not built yet do not fail `npm test`.
export default defineConfig({
  test: { include: ["test/unit/**/*.test.js"], environment: "node" },
});
