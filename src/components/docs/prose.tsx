import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared typography and building blocks for the documentation pages. */

export function DocsPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <article className="min-w-0 max-w-3xl">
      <header className="space-y-2.5 border-b border-line pb-6">
        <h1 className="display text-[1.75rem] font-semibold">{title}</h1>
        {intro ? <p className="text-[14.5px] leading-relaxed text-ink-muted">{intro}</p> : null}
      </header>
      <div className="space-y-8 pt-8">{children}</div>
    </article>
  );
}

export function Section({ id, title, children }: { id?: string; title?: string; children: ReactNode }) {
  return (
    <section id={id} className="space-y-3.5 scroll-mt-20">
      {title ? <h2 className="text-[15.5px] font-semibold tracking-tight text-ink">{title}</h2> : null}
      {children}
    </section>
  );
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[14px] leading-[1.75] text-ink-muted", className)}>{children}</p>;
}

export function Ul({ children }: { children: ReactNode }) {
  return <ul className="space-y-2 text-[14px] leading-[1.7] text-ink-muted">{children}</ul>;
}

export function Li({ children }: { children: ReactNode }) {
  return (
    <li className="relative pl-5 before:absolute before:top-[0.65em] before:left-1 before:size-1 before:bg-ink-subtle">{children}</li>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-sharp bg-surface-muted px-1.5 py-0.5 font-mono text-[12.5px] text-ink">{children}</code>;
}

export function Note({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-sharp border px-4 py-3 text-[13.5px] leading-relaxed",
        tone === "warning" ? "border-heat/35 bg-heat-wash text-ink" : "border-line bg-surface-muted text-ink-muted",
      )}
    >
      {children}
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-sharp border border-line">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-surface-muted/60 text-ink-subtle">
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col" className="px-3.5 py-2 font-medium whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line text-ink-muted">
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3.5 py-2.5 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
