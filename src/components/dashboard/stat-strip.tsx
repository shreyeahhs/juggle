import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The overview numbers, as one printed strip rather than six floating cards.
 *
 * A lattice of hairlines is built from `gap-px` over a line-coloured background,
 * which keeps every join exactly 1px however the grid wraps. Per-cell borders
 * would double up between neighbours and leave a ragged edge on the last row.
 */

export function Stat({ label, value, hint, hot = false }: { label: string; value: ReactNode; hint?: ReactNode; hot?: boolean }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <p className="font-mono text-[10.5px] text-ink-subtle">{label}</p>
      {/* Numbers are data: tabular, so columns of them line up and never jitter. */}
      <p className={cn("mt-1 font-mono text-[1.35rem] leading-none tracking-tight", hot ? "text-heat-ink" : "text-ink")}>{value}</p>
      {hint ? <p className="mt-1.5 text-[11.5px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function StatStrip({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sharp border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">{children}</div>
  );
}
