import { defineConfig } from "drizzle-kit";

// Migrations are generated from the schema without a database connection
// (`pnpm db:generate`) and applied at deploy time with `pnpm db:migrate`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
