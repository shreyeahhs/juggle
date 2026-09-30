import { cn } from "@/lib/utils";

/**
 * Three keys in rotation, and the one in flight is the hot one. A simple
 * geometric mark, drawn rather than pulled from an icon set because it carries
 * the same rule as the rest of the interface: chroma means activity.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("shrink-0", className)} fill="none" aria-hidden>
      <path d="M4.6 17.2C4.6 10.8 7.9 5.2 12 5.2s7.4 5.6 7.4 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="text-line-strong" />
      <rect x="9.6" y="2.8" width="4.8" height="4.8" rx="1" className="fill-heat" />
      <rect x="2.4" y="15.4" width="4.4" height="4.4" rx="1" className="fill-ink-subtle" />
      <rect x="17.2" y="15.4" width="4.4" height="4.4" rx="1" className="fill-ink-subtle" />
    </svg>
  );
}
