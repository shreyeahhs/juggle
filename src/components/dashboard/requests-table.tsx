import { TimeAgo } from "@/components/time-ago";
import { Badge, type Tone } from "@/components/ui/badge";
import { formatDuration, formatNumber } from "@/lib/utils";
import type { RecentRequest } from "@/server/services/stats";

/*
 * A request that worked gets no colour. Amber marks something the rotation
 * absorbed, red marks something it could not, so a long table can be scanned
 * for trouble without reading a single row.
 */
const OUTCOME_TONE: Record<string, Tone> = {
  success: "neutral",
  rate_limited: "heat",
  no_keys: "heat",
  timeout: "heat",
  client_error: "fail",
  upstream_error: "fail",
  internal_error: "fail",
  cancelled: "neutral",
};

/** Request metadata. There is intentionally no prompt or response column. */
export function RequestsTable({ rows, compact = false }: { rows: RecentRequest[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="text-[12px] text-ink-subtle">
          <tr className="border-b border-line">
            <th scope="col" className="px-4 py-2 font-medium">Time</th>
            <th scope="col" className="px-3 py-2 font-medium">Model</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">Latency</th>
            {!compact ? <th scope="col" className="px-3 py-2 font-medium text-right">Tokens</th> : null}
            {!compact ? <th scope="col" className="px-3 py-2 font-medium text-right">Tries</th> : null}
            {!compact ? <th scope="col" className="px-3 py-2 font-medium">Token</th> : null}
            <th scope="col" className="px-4 py-2 font-medium text-right">Key</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface-muted/50">
              <td className="px-4 py-2.5 whitespace-nowrap text-ink-muted">
                <TimeAgo value={row.createdAt} />
              </td>
              <td className="px-3 py-2.5">
                <span className="font-mono text-[12px] text-ink">{row.model ?? "-"}</span>
                {row.stream ? <span className="ml-1.5 text-[11px] text-ink-subtle">stream</span> : null}
              </td>
              <td className="px-3 py-2.5">
                <Badge tone={OUTCOME_TONE[row.outcome] ?? "neutral"}>
                  {row.statusCode} {row.errorCode ? row.errorCode.replaceAll("_", " ") : "ok"}
                </Badge>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{formatDuration(row.latencyMs)}</td>
              {!compact ? (
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{row.totalTokens ? formatNumber(row.totalTokens) : "-"}</td>
              ) : null}
              {!compact ? (
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{row.attempts > 1 ? row.attempts : "-"}</td>
              ) : null}
              {!compact ? <td className="px-3 py-2.5 text-ink-muted">{row.tokenLabel ?? "-"}</td> : null}
              <td className="px-4 py-2.5 text-right font-mono text-[12px] text-ink-subtle">{row.providerKeyHint ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
