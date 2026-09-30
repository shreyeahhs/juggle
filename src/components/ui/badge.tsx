import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Three tones, because the router only has three things to say about a key:
 * it is resting and available (no chroma), it is hot or throttled (amber), or
 * it is refusing to work (red).
 */
export type Tone = "neutral" | "heat" | "fail";

const TONES: Record<Tone, string> = {
  neutral: "border-line bg-surface-muted text-ink-muted",
  heat: "border-heat/35 bg-heat-wash text-heat-ink",
  fail: "border-fail/30 bg-fail-wash text-fail-ink",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sharp border px-1.5 py-0.5 font-mono text-[11.5px] whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A status mark that does not depend on colour alone: the glyph differs per
 * tone, so the row still reads in greyscale and to a screen reader.
 */
export function StatusMark({ tone = "neutral", label, className }: { tone?: Tone; label: string; className?: string }) {
  const marks: Record<Tone, { glyph: string; color: string }> = {
    neutral: { glyph: "·", color: "text-ink-subtle" },
    heat: { glyph: "▲", color: "text-heat-ink" },
    fail: { glyph: "×", color: "text-fail-ink" },
  };
  const mark = marks[tone];
  return (
    <span className={cn("inline-flex items-center gap-2 text-[13px] text-ink", className)}>
      <span aria-hidden className={cn("w-2 shrink-0 text-center font-mono text-[10px] leading-none", mark.color)}>
        {mark.glyph}
      </span>
      {label}
    </span>
  );
}
