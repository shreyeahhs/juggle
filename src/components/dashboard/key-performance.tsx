import { TimeAgo } from "@/components/time-ago";
import { Badge, type Tone } from "@/components/ui/badge";
import { formatNumber, percent } from "@/lib/utils";
import type { KeyHealth, KeyPerformance } from "@/server/services/stats";

/*
 * A resting key is the normal case, so it is the one with no colour. Amber means
 * the key is hot or recovering; red means it is refusing to work.
 */
const HEALTH: Record<KeyHealth, { tone: Tone; label: string }> = {
  healthy: { tone: "neutral", label: "ready" },
  cooling_down: { tone: "heat", label: "cooling down" },
  rate_limited: { tone: "heat", label: "rate limited" },
  degraded: { tone: "heat", label: "degraded" },
  invalid: { tone: "fail", label: "invalid" },
};

/**
 * Per-key performance. Keys are defined by the environment, so there is nothing
 * to edit here: this is how the rotation has actually been using each one.
 */
export function KeyPerformanceTable({ keys, compact = false }: { keys: KeyPerformance[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="text-[12px] text-ink-subtle">
          <tr className="border-b border-line">
            <th scope="col" className="px-4 py-2 font-medium">Key</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Requests</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Share</th>
            {!compact ? <th scope="col" className="px-3 py-2 text-right font-medium">Success</th> : null}
            {!compact ? <th scope="col" className="px-3 py-2 text-right font-medium">Rate limits</th> : null}
            <th scope="col" className="px-4 py-2 text-right font-medium">Last used</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {keys.map((key) => {
            const health = HEALTH[key.health];
            return (
              <tr key={key.fingerprint} className="hover:bg-surface-muted/40">
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{key.label}</span>
                    <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11.5px] text-ink-muted">{key.keyHint}</code>
                    {key.quotaGroup ? <Badge>{key.quotaGroup}</Badge> : null}
                  </div>
                  {!compact && key.modelCooldowns.length ? (
                    <p className="mt-1 text-[12px] text-heat-ink">
                      Cooling down for {key.modelCooldowns.map((cooldown) => cooldown.model).join(", ")}, back{" "}
                      <TimeAgo value={key.modelCooldowns[0]!.until} />
                    </p>
                  ) : null}
                  {!compact && key.status === "invalid" ? (
                    <p className="mt-1 text-[12px] text-fail-ink">
                      {key.statusReason === "permission_denied"
                        ? "The provider denied access for this key. Check its restrictions, then redeploy to retry it."
                        : "The provider rejected this key. Replace it in GEMINI_API_KEYS."}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <Badge tone={health.tone}>{health.label}</Badge>
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-muted">{formatNumber(key.requestCount)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-muted">
                  {/* An even spread across keys is the point of round-robin. */}
                  {key.requestCount ? `${Math.round(key.share * 100)}%` : "-"}
                </td>
                {!compact ? (
                  <td className="px-3 py-3 text-right tabular-nums text-ink-muted">
                    {key.requestCount ? percent(key.successCount, key.requestCount) : "-"}
                  </td>
                ) : null}
                {!compact ? (
                  <td className="px-3 py-3 text-right tabular-nums text-ink-muted">{formatNumber(key.rateLimitCount)}</td>
                ) : null}
                <td className="px-4 py-3 text-right text-ink-muted">
                  <TimeAgo value={key.lastUsedAt} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
