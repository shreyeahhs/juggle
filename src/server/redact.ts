/**
 * Secret scrubbing used by the logger and by every path that forwards
 * provider-originated text (error messages) to clients.
 */

const REDACTED = "[REDACTED]";

/** Field names whose values are always dropped, at any depth. */
const SENSITIVE_FIELD = /^(authorization|proxy-authorization|cookie|set-cookie|x-goog-api-key|x-api-key|api[-_]?key|apikey|key|token|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|password|encrypted[-_]?key|plaintext[-_]?key|messages|prompt|contents)$/i;

const PATTERNS: Array<[RegExp, string]> = [
  // Gateway tokens
  [/gw_live_[0-9A-Za-z]{8,}/g, `gw_live_${REDACTED}`],
  // Google API keys (classic format); new auth-key formats are covered by exact-match scrubbing
  [/AIza[0-9A-Za-z_-]{20,}/g, `AIza${REDACTED}`],
  // Common vendor key shapes, for future providers
  [/\bsk-(?:ant-|proj-|or-)?[0-9A-Za-z_-]{16,}/g, `sk-${REDACTED}`],
  [/\bgsk_[0-9A-Za-z]{16,}/g, `gsk_${REDACTED}`],
  // Bearer credentials in free text
  [/\b(bearer\s+)[^\s"',;]{8,}/gi, `$1${REDACTED}`],
  // key=… in URLs
  [/([?&](?:key|api_key|apikey|token)=)[^&\s"']+/gi, `$1${REDACTED}`],
  // Google Cloud project numbers / ids in error text ("projects/123456789")
  [/(projects\/)[0-9A-Za-z-]+/g, `$1${REDACTED}`],
];

/** Replaces known secret shapes plus any explicitly provided secret values. */
export function scrubText(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join(REDACTED);
  }
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Deep-copies a value, removing sensitive fields and scrubbing strings. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: scrubText(value.message), ...(value.cause ? { cause: redactValue(value.cause, depth + 1) } : {}) };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  if (value instanceof Headers) return redactValue(Object.fromEntries(value.entries()), depth);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_FIELD.test(key) ? REDACTED : redactValue(child, depth + 1);
  }
  return out;
}
