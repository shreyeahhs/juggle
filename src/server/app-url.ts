import "server-only";
import { connection } from "next/server";

/**
 * The deployment's public URL, read at request time.
 *
 * `connection()` keeps this out of the build: a Docker image built once must
 * pick up APP_URL from the environment it actually runs in, otherwise every
 * copy-paste example would show the URL from the build machine.
 */
export async function getAppUrl(): Promise<string> {
  await connection();
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
