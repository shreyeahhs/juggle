import type { KeyCandidate } from "./key-store";

export function isCoolingDown(candidate: KeyCandidate, now: Date): boolean {
  return (
    (candidate.cooldownUntil !== null && candidate.cooldownUntil > now) ||
    (candidate.modelCooldownUntil !== null && candidate.modelCooldownUntil > now)
  );
}

export function isEligible(candidate: KeyCandidate, now: Date): boolean {
  return candidate.status === "active" && !isCoolingDown(candidate, now);
}

/** When an active-but-cooling key becomes usable again for this model. */
export function eligibleAgainAt(candidate: KeyCandidate): Date | null {
  if (candidate.status !== "active") return null;
  const times = [candidate.cooldownUntil, candidate.modelCooldownUntil].filter((time): time is Date => time !== null);
  if (!times.length) return null;
  return new Date(Math.max(...times.map((time) => time.getTime())));
}

/**
 * How the next key is chosen among equally healthy candidates.
 *
 * - `round_robin` (default): strict least-recently-used, so consecutive
 *   requests cycle through the pool one key at a time. Spreading traffic is the
 *   best way to avoid hitting a provider limit in the first place, which is
 *   what keeps users from ever seeing a delay.
 * - `power_of_two`: sample two candidates and take the less recently used.
 *   Slightly worse spread, but under heavy concurrency it avoids many
 *   simultaneous requests all picking the same "oldest" key from one snapshot.
 */
export type SelectionStrategy = "round_robin" | "power_of_two";

export interface SelectOptions {
  now: Date;
  /** Keys already attempted during this request. */
  tried: ReadonlySet<string>;
  /** Only after a transient error may an already-tried key be used again (and only if nothing untried is left). */
  allowRetry: boolean;
  random: () => number;
  strategy?: SelectionStrategy;
}

const lastUsed = (candidate: KeyCandidate) => candidate.lastUsedAt?.getTime() ?? 0;

/**
 * Picks the next key:
 *  1. eligible = active, not cooling down (key-wide or for this model)
 *  2. prefer keys not yet tried in this request
 *  3. prefer the healthiest tier (fewest consecutive failures)
 *  4. cycle within that tier according to the strategy
 */
export function selectKey(candidates: readonly KeyCandidate[], options: SelectOptions): KeyCandidate | undefined {
  const eligible = candidates.filter((candidate) => isEligible(candidate, options.now));
  let pool = eligible.filter((candidate) => !options.tried.has(candidate.fingerprint));
  if (!pool.length && options.allowRetry) pool = eligible;
  if (!pool.length) return undefined;

  const fewestFailures = Math.min(...pool.map((candidate) => candidate.consecutiveFailures));
  const tier = pool.filter((candidate) => candidate.consecutiveFailures === fewestFailures);
  if (tier.length === 1) return tier[0];

  if ((options.strategy ?? "round_robin") === "round_robin") {
    // Least recently used wins; the id keeps the order stable for never-used keys.
    return [...tier].sort((a, b) => lastUsed(a) - lastUsed(b) || a.fingerprint.localeCompare(b.fingerprint))[0];
  }

  const first = Math.floor(options.random() * tier.length);
  let second = Math.floor(options.random() * (tier.length - 1));
  if (second >= first) second += 1;
  const a = tier[first]!;
  const b = tier[second]!;
  return lastUsed(a) <= lastUsed(b) ? a : b;
}
