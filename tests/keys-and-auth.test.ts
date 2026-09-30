import { describe, expect, it } from "vitest";
import { GATEWAY_KEY_PREFIX, generateGatewayKey, isWellFormedGatewayKey, providerKeyHint, sha256Hex } from "@/server/crypto/tokens";
import { createSessionValue, isOwnerPassword, verifySessionValue } from "@/server/auth/session";
import { fingerprint, matchGatewayToken, parseGatewayTokens, parseProviderKeys } from "@/server/keys/env-keys";
import { redactValue, scrubText } from "@/server/redact";

const SECRET = "test-secret-test-secret-test-secret-0123456789";
const KEY_ONE = "AIzaSyExampleExampleExampleExampleExample";
const KEY_TWO = "AQ.Ab8RN6ExampleExampleExampleExampleExample";

describe("provider keys from the environment", () => {
  it("parses bare and labelled entries", () => {
    const keys = parseProviderKeys([KEY_ONE, `spare=${KEY_TWO}`], { provider: "gemini", authSecret: SECRET });

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatchObject({ label: "Key 1", secret: KEY_ONE, provider: "gemini", quotaGroup: null });
    expect(keys[1]).toMatchObject({ label: "spare", secret: KEY_TWO });
    // Only a hint is ever displayed.
    expect(keys[0]!.hint).toBe("AIza…mple");
  });

  it("accepts the newer Gemini auth-key format, which has no AIza prefix", () => {
    const keys = parseProviderKeys([KEY_TWO], { provider: "gemini", authSecret: SECRET });
    expect(keys).toHaveLength(1);
    expect(keys[0]!.secret).toBe(KEY_TWO);
  });

  it("gives each key a stable fingerprint that never contains the secret", () => {
    const [first] = parseProviderKeys([KEY_ONE], { provider: "gemini", authSecret: SECRET });
    const [again] = parseProviderKeys([`renamed=${KEY_ONE}`], { provider: "gemini", authSecret: SECRET });

    // A relabelled key keeps its identity, so its statistics carry over.
    expect(first!.fingerprint).toBe(again!.fingerprint);
    expect(first!.fingerprint).not.toContain(KEY_ONE);
    // A different deployment secret yields a different fingerprint.
    expect(fingerprint("another-secret-another-secret-1234", "gemini", KEY_ONE)).not.toBe(first!.fingerprint);
  });

  it("drops duplicates so one key cannot take two turns in the rotation", () => {
    const keys = parseProviderKeys([KEY_ONE, `copy=${KEY_ONE}`, KEY_TWO], { provider: "gemini", authSecret: SECRET });
    expect(keys.map((key) => key.secret)).toEqual([KEY_ONE, KEY_TWO]);
  });

  it("applies a shared quota group to every key", () => {
    const keys = parseProviderKeys([KEY_ONE, KEY_TWO], { provider: "gemini", authSecret: SECRET, quotaGroup: "project-a" });
    expect(keys.every((key) => key.quotaGroup === "project-a")).toBe(true);
  });

  it("reads a per-key quota group from `name@group=value`", () => {
    const keys = parseProviderKeys([`main@project-a=${KEY_ONE}`, `@project-b=${KEY_TWO}`], { provider: "gemini", authSecret: SECRET });

    expect(keys[0]).toMatchObject({ label: "main", quotaGroup: "project-a", secret: KEY_ONE });
    // No label, just a group: the label falls back to its position.
    expect(keys[1]).toMatchObject({ label: "Key 2", quotaGroup: "project-b", secret: KEY_TWO });
  });

  it("keeps keys from different projects in different groups", () => {
    // The case this syntax exists for. Two Google Cloud projects meter
    // separately, so one project's 429 must not park the other's keys.
    const keys = parseProviderKeys([`a@project-a=${KEY_ONE}`, `b@project-b=${KEY_TWO}`], {
      provider: "gemini",
      authSecret: SECRET,
      quotaGroup: "ignored-when-a-key-names-its-own",
    });

    expect(new Set(keys.map((key) => key.quotaGroup))).toEqual(new Set(["project-a", "project-b"]));
  });

  it("falls back to the deployment-wide group only for keys that name none", () => {
    const keys = parseProviderKeys([`solo@project-b=${KEY_ONE}`, KEY_TWO], {
      provider: "gemini",
      authSecret: SECRET,
      quotaGroup: "project-a",
    });

    expect(keys[0]!.quotaGroup).toBe("project-b");
    expect(keys[1]!.quotaGroup).toBe("project-a");
  });

  it("treats an empty group as no group", () => {
    const keys = parseProviderKeys([`named@=${KEY_ONE}`], { provider: "gemini", authSecret: SECRET });
    expect(keys[0]).toMatchObject({ label: "named", quotaGroup: null });
  });

  it("splits on the last @, so a label may contain one", () => {
    const keys = parseProviderKeys([`me@home@project-a=${KEY_ONE}`], { provider: "gemini", authSecret: SECRET });
    expect(keys[0]).toMatchObject({ label: "me@home", quotaGroup: "project-a" });
  });

  it("does not read groups out of gateway tokens", () => {
    // Groups are a provider-quota idea. A token label keeps its '@' intact.
    const [token] = parseGatewayTokens([`ci@build=${"gw_live_" + "x".repeat(40)}`], SECRET);
    expect(token!.label).toBe("ci@build");
  });

  it("does not mistake a secret containing '=' for a labelled entry", () => {
    const padded = `${KEY_TWO}==`;
    const keys = parseProviderKeys([padded], { provider: "gemini", authSecret: SECRET });
    expect(keys[0]).toMatchObject({ label: "Key 1", secret: padded, quotaGroup: null });
  });

  it("ignores empty entries", () => {
    expect(parseProviderKeys(["", "   "], { provider: "gemini", authSecret: SECRET })).toEqual([]);
  });
});

describe("gateway tokens from the environment", () => {
  const tokenA = generateGatewayKey().token;
  const tokenB = generateGatewayKey().token;

  it("matches a configured token and reports its label", () => {
    const tokens = parseGatewayTokens([`app=${tokenA}`, `ci=${tokenB}`], SECRET);
    expect(matchGatewayToken(tokens, tokenB)?.label).toBe("ci");
  });

  it("rejects anything not configured", () => {
    const tokens = parseGatewayTokens([tokenA], SECRET);
    expect(matchGatewayToken(tokens, tokenB)).toBeUndefined();
    expect(matchGatewayToken(tokens, "")).toBeUndefined();
    expect(matchGatewayToken(tokens, `${tokenA} `)).toBeUndefined();
    expect(matchGatewayToken([], tokenA)).toBeUndefined();
  });
});

describe("generated tokens", () => {
  it("are long, prefixed and checksummed", () => {
    const { token, hash, displayPrefix } = generateGatewayKey();
    expect(token.startsWith(GATEWAY_KEY_PREFIX)).toBe(true);
    expect(isWellFormedGatewayKey(token)).toBe(true);
    expect(hash).toBe(sha256Hex(token));
    expect(displayPrefix).toMatch(/^gw_live_.{4}….{4}$/);
  });

  it("reject typos before anything else looks at them", () => {
    const { token } = generateGatewayKey();
    expect(isWellFormedGatewayKey(`${token.slice(0, -1)}x`)).toBe(false);
    expect(isWellFormedGatewayKey(token.slice(0, -1))).toBe(false);
    expect(isWellFormedGatewayKey(KEY_ONE)).toBe(false);
  });

  it("are unique", () => {
    expect(new Set(Array.from({ length: 200 }, () => generateGatewayKey().token)).size).toBe(200);
  });

  it("show only the first and last characters as a hint", () => {
    expect(providerKeyHint(KEY_ONE)).toBe("AIza…mple");
    expect(providerKeyHint("short")).toBe("…");
  });
});

describe("owner session", () => {
  it("accepts a signed, unexpired cookie", () => {
    const value = createSessionValue(Date.now() + 60_000, SECRET);
    expect(verifySessionValue(value, SECRET)).toBe(true);
  });

  it("rejects an expired, tampered, foreign or missing cookie", () => {
    expect(verifySessionValue(createSessionValue(Date.now() - 1, SECRET), SECRET)).toBe(false);
    expect(verifySessionValue(createSessionValue(Date.now() + 60_000, "another-secret-another-secret-1234"), SECRET)).toBe(false);
    expect(verifySessionValue(undefined, SECRET)).toBe(false);
    expect(verifySessionValue("not-a-session", SECRET)).toBe(false);

    // Extending the expiry without a matching signature must not work.
    const [, signature] = createSessionValue(Date.now() + 1_000, SECRET).split(".");
    expect(verifySessionValue(`${Date.now() + 999_000}.${signature}`, SECRET)).toBe(false);
  });

  it("compares the owner password exactly", () => {
    expect(isOwnerPassword("hunter2hunter2", "hunter2hunter2")).toBe(true);
    expect(isOwnerPassword("hunter2hunter2 ", "hunter2hunter2")).toBe(false);
    expect(isOwnerPassword("", "hunter2hunter2")).toBe(false);
  });
});

describe("secret scrubbing", () => {
  it("removes provider and gateway keys from free text", () => {
    const token = generateGatewayKey().token;
    const scrubbed = scrubText(`failed with ${KEY_ONE} and ${token} for projects/123456789`);
    expect(scrubbed).not.toContain(KEY_ONE);
    expect(scrubbed).not.toContain(token.slice(8));
    expect(scrubbed).not.toContain("123456789");
  });

  it("removes explicitly supplied secrets in unknown formats", () => {
    expect(scrubText(`token=${KEY_TWO}`, [KEY_TWO])).not.toContain(KEY_TWO);
  });

  it("redacts sensitive fields at any depth", () => {
    const redacted = JSON.stringify(
      redactValue({
        safe: "ok",
        authorization: "Bearer secret-token-value",
        nested: { apiKey: KEY_ONE, messages: [{ role: "user", content: "private prompt" }] },
      }),
    );
    expect(redacted).toContain("ok");
    expect(redacted).not.toContain("secret-token-value");
    expect(redacted).not.toContain(KEY_ONE);
    expect(redacted).not.toContain("private prompt");
  });
});
