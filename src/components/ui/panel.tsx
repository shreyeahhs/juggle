import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * A panel is a bounded region for the dashboard, where a person is scanning
 * tables and needs to know where one dataset stops and the next begins.
 *
 * Marketing pages do not use it. There, rules and columns group content, and a
 * grid of identical cards would be the lazy container the craft floor warns
 * about. Panels never nest.
 */

export function Panel({ className, ...props }: ComponentPropsWithoutRef<"section">) {
  return <section className={cn("rounded-sharp border border-line bg-surface", className)} {...props} />;
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="text-[12.5px] leading-relaxed text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("px-4 py-3.5", className)} {...props} />;
}

/** Shown instead of a table when there is nothing yet, with the next step rather than an apology. */
export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2.5 px-4 py-10">
      {/* A rule instead of an icon: the empty row is where data will appear. */}
      <span aria-hidden className="h-px w-8 bg-line-strong" />
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {description ? <p className="max-w-md text-[12.5px] leading-relaxed text-ink-muted">{description}</p> : null}
      {action}
    </div>
  );
}
