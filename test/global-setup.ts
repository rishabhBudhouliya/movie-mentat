import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Bring the test database's schema up to date once per run. Vitest's `test.env`
// isn't applied to global setup, so the URL is resolved the same way here.
export default function setup(): void {
  const url =
    process.env.TEST_DATABASE_URL ?? "postgresql://mentat:mentat@localhost:5433/movie_mentat_test";
  // The local binary, not `pnpm exec`: pnpm may only be reachable via corepack.
  execFileSync(resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    env: { ...process.env, DIRECT_URL: url, DATABASE_URL: url },
    stdio: "pipe",
  });
}
