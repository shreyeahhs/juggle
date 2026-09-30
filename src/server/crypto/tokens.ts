import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { crc32 } from "node:zlib";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Uniform random base62 string (rejection sampling avoids modulo bias). */
export function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

function toBase62(value: number, width: number): string {
  let out = "";
  let n = value;
  while (n > 0) {
    out = BASE62[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out.padStart(width, "0");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Gateway API keys:  gw_live_<40 random base62><6 base62 CRC32 checksum>
 *
 * - ~238 bits of entropy, so a plain SHA-256 is a sufficient at-rest hash
 *   (the GitHub token model); no slow KDF is needed for random tokens.
 * - The checksum rejects typos and garbage without touching the database and
 *   lets secret scanners recognise leaked tokens with near-zero false positives.
 * ──────────────────────────────────────────────────────────────────────────── */

export const GATEWAY_KEY_PREFIX = "gw_live_";
const RANDOM_LENGTH = 40;
const CHECKSUM_LENGTH = 6;
const GATEWAY_KEY_LENGTH = GATEWAY_KEY_PREFIX.length + RANDOM_LENGTH + CHECKSUM_LENGTH;
const GATEWAY_KEY_PATTERN = new RegExp(`^${GATEWAY_KEY_PREFIX}[0-9A-Za-z]{${RANDOM_LENGTH + CHECKSUM_LENGTH}}$`);

function checksum(body: string): string {
  return toBase62(crc32(body), CHECKSUM_LENGTH);
}

export interface GeneratedGatewayKey {
  token: string;
  hash: string;
  displayPrefix: string;
}

export function generateGatewayKey(): GeneratedGatewayKey {
  const body = GATEWAY_KEY_PREFIX + randomBase62(RANDOM_LENGTH);
  const token = body + checksum(body);
  return { token, hash: sha256Hex(token), displayPrefix: gatewayKeyDisplay(token) };
}

/** Cheap structural validation, done before any database lookup. */
export function isWellFormedGatewayKey(token: string): boolean {
  if (token.length !== GATEWAY_KEY_LENGTH || !GATEWAY_KEY_PATTERN.test(token)) return false;
  const body = token.slice(0, -CHECKSUM_LENGTH);
  return safeEqual(checksum(body), token.slice(-CHECKSUM_LENGTH));
}

export function gatewayKeyDisplay(token: string): string {
  return `${token.slice(0, GATEWAY_KEY_PREFIX.length + 4)}…${token.slice(-4)}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Provider key fingerprints & hints
 * ──────────────────────────────────────────────────────────────────────────── */

let fingerprintKey: { secret: string; key: Buffer } | undefined;

function deriveFingerprintKey(secret: string): Buffer {
  if (fingerprintKey?.secret !== secret) {
    const key = Buffer.from(hkdfSync("sha256", secret, "juggle", "provider-key-fingerprint:v1", 32));
    fingerprintKey = { secret, key };
  }
  return fingerprintKey.key;
}

/**
 * Keyed HMAC so a database leak can't be used to confirm whether a known API
 * key is stored. Used only for per-account duplicate detection.
 */
export function providerKeyFingerprint(secret: string, provider: string, plaintextKey: string): string {
  return createHmac("sha256", deriveFingerprintKey(secret)).update(`${provider}:${plaintextKey}`, "utf8").digest("hex");
}

/** Display hint such as `AIza…8F2K`. Short keys reveal less. */
export function providerKeyHint(plaintextKey: string): string {
  const key = plaintextKey.trim();
  if (key.length >= 16) return `${key.slice(0, 4)}…${key.slice(-4)}`;
  if (key.length >= 8) return `…${key.slice(-2)}`;
  return "…";
}
