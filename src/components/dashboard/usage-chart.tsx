"use client";

import { useState } from "react";
import { formatDuration, formatNumber } from "@/lib/utils";
import type { UsagePoint, UsageRange } from "@/server/services/stats";

/**
 * Requests over time: stacked columns of served against failed.
 *
 * Two series, not three. Rate limits are not disjoint from the other two, since
 * a throttled request that succeeds on the next key counts as served, so a third
 * stacked band would double count. They are reported in the stat strip, the
 * tooltip and the table instead. The two colours separate by luminance before
 * hue, so the chart survives every colour vision deficiency and both themes.
 */

interface Props {
  points: UsagePoint[];
  range: UsageRange;
  bucket: "hour" | "day";
}

const HOUR_LABEL = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function niceCeiling(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

export function UsageChart({ points, range, bucket }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const label = (date: Date) => (bucket === "hour" ? HOUR_LABEL.format(date) : DAY_LABEL.format(date));

  const peak = Math.max(...points.map((point) => point.total), 0);
  const max = niceCeiling(peak);
  const totals = points.reduce(
    (acc, point) => ({ total: acc.total + point.total, failed: acc.failed + point.failed, rateLimited: acc.rateLimited + point.rateLimited }),
    { total: 0, failed: 0, rateLimited: 0 },
  );
  const ticks = [max, max / 2, 0];
  const point = active === null ? null : points[active];
  // Keep the tooltip inside the plot near the edges.
  const anchor = active === null ? 0 : (active + 0.5) / points.length;

  return (
    <figure className="m-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <figcaption className="text-[13px] text-ink-muted">
          {formatNumber(totals.total)} requests in the last {range === "24h" ? "24 hours" : range === "7d" ? "7 days" : "30 days"}
          {totals.failed ? ` · ${formatNumber(totals.failed)} failed` : ""}
        </figcaption>
        <ul className="flex items-center gap-3 text-[12px] text-ink-muted">
          <li className="flex items-center gap-1.5">
            <span className="size-2 bg-plot-served" aria-hidden />
            Succeeded
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2 bg-plot-failed" aria-hidden />
            Failed
          </li>
        </ul>
      </div>

      <div className="relative px-4 pt-4 pb-1">
        {/* Gridlines sit behind the marks and stay recessive: 1px, solid, one step off surface. */}
        <div className="pointer-events-none absolute inset-x-4 top-4 bottom-7">
          {ticks.map((tick, index) => (
            <div key={tick} className="absolute inset-x-0 flex items-center gap-2" style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}>
              <span className="w-8 shrink-0 text-right text-[10.5px] tabular-nums text-ink-subtle">{formatNumber(tick)}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          ))}
        </div>

        <div className="relative ml-10 flex h-40 items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
          {points.map((item, index) => {
            const successHeight = (item.success / max) * 100;
            const failedHeight = (item.failed / max) * 100;
            return (
              <button
                key={item.bucket.toISOString()}
                type="button"
                // The whole column is the hit target, not just the drawn bar.
                className="group relative flex h-full flex-1 cursor-default flex-col justify-end focus:outline-none"
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                aria-label={`${label(item.bucket)}: ${item.total} requests, ${item.failed} failed`}
              >
                <span
                  className={`block w-full  bg-plot-failed transition-opacity ${active !== null && active !== index ? "opacity-60" : ""}`}
                  style={{ height: `${failedHeight}%` }}
                />
                <span
                  className={`block w-full bg-plot-served transition-opacity ${item.failed ? "mt-[2px]" : ""} ${
                    active !== null && active !== index ? "opacity-60" : ""
                  }`}
                  style={{ height: `${successHeight}%` }}
                />
                {item.total === 0 ? <span className="block h-px w-full bg-line-strong" /> : null}
              </button>
            );
          })}

          {point ? (
            <div
              // Anchored inside the plot: floating it above would cover the card header.
              className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-sharp border border-line bg-surface p-2.5 text-[12px] shadow-[0_6px_16px_-4px_oklch(22%_0.013_62_/_0.18)]"
              style={{ left: `clamp(88px, ${anchor * 100}%, calc(100% - 88px))` }}
              role="status"
            >
              <p className="font-medium text-ink">{label(point.bucket)}</p>
              <dl className="mt-1.5 space-y-1 text-ink-muted">
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-1.5">
                    <span className="size-2 bg-plot-served" aria-hidden />
                    Succeeded
                  </dt>
                  <dd className="tabular-nums text-ink">{formatNumber(point.success)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-1.5">
                    <span className="size-2 bg-plot-failed" aria-hidden />
                    Failed
                  </dt>
                  <dd className="tabular-nums text-ink">{formatNumber(point.failed)}</dd>
                </div>
                {point.rateLimited ? (
                  <div className="flex justify-between gap-3">
                    <dt>of which rate limited</dt>
                    <dd className="tabular-nums text-ink">{formatNumber(point.rateLimited)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3 border-t border-line pt-1">
                  <dt>Avg latency</dt>
                  <dd className="tabular-nums text-ink">{formatDuration(point.avgLatencyMs)}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </div>

        <div className="mt-2 ml-10 flex justify-between text-[10.5px] text-ink-subtle">
          <span>{points[0] ? label(points[0].bucket) : ""}</span>
          <span>{points.at(-1) ? label(points.at(-1)!.bucket) : ""}</span>
        </div>
      </div>

      {/* Every value stays reachable without hover or colour. */}
      <details className="border-t border-line px-4 py-3">
        <summary className="cursor-pointer text-[12.5px] text-ink-muted hover:text-ink">View as table</summary>
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-ink-subtle">
              <tr>
                <th scope="col" className="py-1 font-medium">Bucket</th>
                <th scope="col" className="py-1 text-right font-medium">Succeeded</th>
                <th scope="col" className="py-1 text-right font-medium">Failed</th>
                <th scope="col" className="py-1 text-right font-medium">Avg latency</th>
              </tr>
            </thead>
            <tbody className="text-ink-muted">
              {points.map((item) => (
                <tr key={item.bucket.toISOString()}>
                  <td className="py-1">{label(item.bucket)}</td>
                  <td className="py-1 text-right tabular-nums">{formatNumber(item.success)}</td>
                  <td className="py-1 text-right tabular-nums">{formatNumber(item.failed)}</td>
                  <td className="py-1 text-right tabular-nums">{formatDuration(item.avgLatencyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
