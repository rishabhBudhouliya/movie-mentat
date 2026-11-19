import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env files. Node's built-in loader avoids a dotenv
// dependency. A missing file is fine: CI and Vercel set real env vars.
try {
  process.loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Migrations use the direct connection. The app connects through the pooled
  // DATABASE_URL via the pg driver adapter (src/server/db.ts). Optional here so
  // `prisma generate` works in CI without a database.
  ...(process.env.DIRECT_URL ? { datasource: { url: process.env.DIRECT_URL } } : {}),
});
