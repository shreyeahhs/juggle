export type ServiceResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
export const fail = <T = never>(code: string, message: string): ServiceResult<T> => ({ ok: false, code, message });

/** Postgres unique_violation, across drivers (postgres-js / PGlite / wrapped by Drizzle). */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
