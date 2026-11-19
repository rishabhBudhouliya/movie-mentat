import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against a real Postgres (PLAN.md, "Testing"): the separate
// movie_mentat_test database locally, a service container in CI.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://mentat:mentat@localhost:5433/movie_mentat_test";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_URL: TEST_DATABASE_URL,
      APP_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
    },
    // One shared database: files run one at a time so truncation can't race.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      // High gate on core modules only (PLAN.md). Glue that needs Google or
      // Next's request context is covered by the end-to-end check instead.
      include: ["src/server/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["src/server/auth/google.ts", "src/server/auth/current-user.ts", "**/*.test.ts"],
      thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 },
    },
  },
});
