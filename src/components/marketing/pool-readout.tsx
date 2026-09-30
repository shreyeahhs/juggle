import { cn } from "@/lib/utils";

/**
 * The hero visual: the real shape of the dashboard's key table, with example
 * traffic. Deliberately still. The walkthrough below is the page's one moving
 * moment, and a second animation here would compete with it and delay the
 * largest paint for nothing.
 *
 * Not a screenshot and not a drawing: the same columns, type and tokens the
 * dashboard uses, so what the page promises is what the product shows.
 */

const ROWS = [
  { label: "main", share: 0.19, requests: 1_284, state: "serving" as const },
  { label: "spare-1", share: 0.17, requests: 1_147, state: "ready" as const },
  { label: "spare-2", share: 0.14, requests: 938, state: "429 cooling 41s" as const },
  { label: "spare-3", share: 0.13, requests: 871, state: "ready" as const },
  { label: "spare-4", share: 0.12, requests: 802, state: "ready" as const },
  { label: "spare-5", share: 0.11, requests: 743, state: "ready" as const },
  { label: "spare-6", share: 0.08, requests: 536, state: "ready" as const },
  { label: "spare-7", share: 0.06, requests: 412, state: "ready" as const },
];

const HOT = new Set(["serving", "429 cooling 41s"]);

export function PoolReadout({ className }: { className?: string }) {
  const total = ROWS.reduce((sum, row) => sum + row.requests, 0);

  return (
    <figure className={cn("space-y-2", className)}>
      <div className="overflow-hidden rounded-sharp border border-line bg-surface">
        <div className="flex items-baseline justify-between gap-3 border-b border-line bg-surface-muted/60 px-3 py-2">
          <span className="font-mono text-[11px] text-ink">key rotation</span>
          <span className="font-mono text-[11px] text-ink-subtle">last 24 hours</span>
        </div>

        <table className="w-full">
          <caption className="sr-only">Example provider key pool, showing each key&rsquo;s share of traffic</caption>
          <thead>
            <tr className="border-b border-line font-mono text-[10px] text-ink-subtle">
              <th scope="col" className="py-1.5 pl-3 text-left font-normal whitespace-nowrap">
                key
              </th>
              <th scope="col" className="py-1.5 pl-3 text-left font-normal">
                share
              </th>
              <th scope="col" className="py-1.5 pl-3 text-right font-normal">
                served
              </th>
              <th scope="col" className="py-1.5 pr-3 pl-3 text-right font-normal">
                state
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const hot = HOT.has(row.state);
              return (
                <tr key={row.label} className="border-b border-line/70 last:border-0">
                  <td className="py-1.5 pl-3 font-mono text-[11px] whitespace-nowrap text-ink">{row.label}</td>
                  <td className="w-[30%] py-1.5 pr-3 pl-3">
                    {/* Chroma is activity: only the working keys carry amber. */}
                    <span className="block h-1 w-full bg-line">
                      <span
                        className={cn("block h-full origin-left", hot ? "bg-heat" : "bg-ink-subtle")}
                        style={{ transform: `scaleX(${row.share / 0.2})` }}
                      />
                    </span>
                  </td>
                  <td className="py-1.5 pl-3 text-right font-mono text-[11px] text-ink-muted">{row.requests.toLocaleString("en")}</td>
                  <td className={cn("py-1.5 pr-3 pl-3 text-right font-mono text-[10.5px] whitespace-nowrap", hot ? "text-heat-ink" : "text-ink-subtle")}>{row.state}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line px-3 py-2 font-mono text-[11px]">
          <span className="text-ink-muted">{total.toLocaleString("en")} served</span>
          <span className="text-ink-muted">
            1 throttled, <span className="text-ink">0 reached your app</span>
          </span>
        </div>
      </div>

      <figcaption className="text-[12px] text-ink-subtle">Your dashboard, with example traffic across eight keys.</figcaption>
    </figure>
  );
}
