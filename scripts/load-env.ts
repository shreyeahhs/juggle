import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Loads .env files for standalone scripts the same way Next.js does
 * (.env.local overrides .env). Already-set variables are never overwritten.
 */
export function loadEnvFiles(): void {
  const mode = process.env.NODE_ENV ?? "development";
  const files = [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"];
  for (const file of files) {
    const fullPath = path.join(process.cwd(), file);
    if (existsSync(fullPath)) process.loadEnvFile(fullPath);
  }
}
