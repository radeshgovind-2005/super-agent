import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Build dist/ once before the suite so the smoke test runs the real bin.
export default function setup(): void {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const tsc = fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));
  execFileSync(tsc, ["-p", "tsconfig.build.json"], { cwd: root, stdio: "inherit" });
}
