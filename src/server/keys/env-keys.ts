import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { providerKeyHint } from "@/server/crypto/tokens";
import type { ProviderId } from "@/server/providers/types";

/**
 * Keys and tokens configured through the environment.
 *
 * Entries are comma-separated and may be labelled: `name=value`. The label is
 * cosmetic (it appears in the dashboard and request log) and never secret.
 *
 * A provider key may also name the quota it shares, as `name@group=value` or
 * just `@group=value`. This matters because providers meter per project rather
 * than per key: Gemini keys from one Google Cloud project draw on one quota, so
 * a 429 on any of them means every key in that project is spent. Grouping them
 * lets the router cool the whole group at once instead of rediscovering the
 * limit key by key. Keys from separate projects must be in separate groups, or
 * one project's exhaustion would park keys that are still good.
 *
 * `GEMINI_QUOTA_GROUP` remains the default for keys that name no group, which
 * is the right setting when every key comes from a single project.
 *
 * Nothing here is written to the database. A key's identity across restarts is
 * its fingerprint, an HMAC of the secret, which is what the stats and cooldown
 * rows are keyed on.
 */

export interface ConfiguredProviderKey {
  /** Stable identity across restarts and redeploys. */
  fingerprint: string;
  label: string;
  /** Display-only, e.g. `AIza…8F2K`. */
  hint: string;
  provider: ProviderId;
  quotaGroup: string | null;
  /** The secret itself. Never leaves the server, never logged, never persisted. */
  secret: string;
}

export interface ConfiguredGatewayToken {
  label: string;
  hint: string;
  /** Hash used for constant-time comparison and for the request log. */
  fingerprint: string;
  secret: string;
}

interface ParsedEntry {
  label: string;
  /** Only ever set for provider keys, which are the things that share a quota. */
  group: string | null;
  secret: string;
}

/** What a human name may contain. A base64 secret cannot match this with an '@'. */
const LABEL = /^[\w .@-]+$/;
/**
 * A label is a short name. Anything longer is a secret that happens to contain
 * '=', such as base64 padding, and must be left whole.
 */
const MAX_NAME = 40;

/**
 * Splits `name=value`, or `name@group=value` where groups are allowed, into its
 * parts. An unlabelled entry gets a positional name.
 */
function parseEntry(entry: string, index: number, fallbackPrefix: string, allowGroups = false): ParsedEntry | null {
  const separator = entry.indexOf("=");
  const prefix = entry.slice(0, separator);

  if (separator > 0 && prefix.length <= MAX_NAME * 2 && LABEL.test(prefix)) {
    // The group is the trailing qualifier, so a label may itself contain '@'.
    const at = allowGroups ? prefix.lastIndexOf("@") : -1;
    const label = (at >= 0 ? prefix.slice(0, at) : prefix).trim();
    const group = at >= 0 ? prefix.slice(at + 1).trim() : "";

    if (label.length <= MAX_NAME && group.length <= MAX_NAME) {
      const secret = entry.slice(separator + 1).trim();
      if (!secret) return null;
      return { label: label || `${fallbackPrefix} ${index + 1}`, group: group || null, secret };
    }
  }

  const secret = entry.trim();
  return secret ? { label: `${fallbackPrefix} ${index + 1}`, group: null, secret } : null;
}

function fingerprintKey(authSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", authSecret, "juggle", "key-fingerprint:v1", 32));
}

/** Keyed so a leaked database cannot be used to confirm which keys a deployment holds. */
export function fingerprint(authSecret: string, namespace: string, secret: string): string {
  return createHmac("sha256", fingerprintKey(authSecret)).update(`${namespace}:${secret}`, "utf8").digest("hex");
}

export function parseProviderKeys(
  entries: readonly string[],
  options: { provider: ProviderId; authSecret: string; quotaGroup?: string | null },
): ConfiguredProviderKey[] {
  const seen = new Set<string>();
  const keys: ConfiguredProviderKey[] = [];
  // Used by any key that does not name a group of its own.
  const defaultGroup = options.quotaGroup?.trim() || null;

  for (const [index, entry] of entries.entries()) {
    const parsed = parseEntry(entry, index, "Key", true);
    if (!parsed) continue;
    const print = fingerprint(options.authSecret, options.provider, parsed.secret);
    // Duplicates would double a key's share of the rotation for no benefit.
    if (seen.has(print)) continue;
    seen.add(print);
    keys.push({
      fingerprint: print,
      label: parsed.label,
      hint: providerKeyHint(parsed.secret),
      provider: options.provider,
      quotaGroup: parsed.group ?? defaultGroup,
      secret: parsed.secret,
    });
  }
  return keys;
}

export function parseGatewayTokens(entries: readonly string[], authSecret: string): ConfiguredGatewayToken[] {
  const seen = new Set<string>();
  const tokens: ConfiguredGatewayToken[] = [];

  for (const [index, entry] of entries.entries()) {
    const parsed = parseEntry(entry, index, "Token");
    if (!parsed) continue;
    const print = fingerprint(authSecret, "gateway", parsed.secret);
    if (seen.has(print)) continue;
    seen.add(print);
    tokens.push({ label: parsed.label, hint: providerKeyHint(parsed.secret), fingerprint: print, secret: parsed.secret });
  }
  return tokens;
}

/** Constant-time lookup, so a wrong token reveals nothing through timing. */
export function matchGatewayToken(tokens: readonly ConfiguredGatewayToken[], candidate: string): ConfiguredGatewayToken | undefined {
  const supplied = Buffer.from(candidate);
  let matched: ConfiguredGatewayToken | undefined;
  for (const token of tokens) {
    const expected = Buffer.from(token.secret);
    // Compare every token so the loop takes the same time whichever one matches.
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) matched = token;
  }
  return matched;
}
