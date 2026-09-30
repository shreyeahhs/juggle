import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const inputStyles = (className?: string) =>
  cn(
    "block w-full rounded-sharp border border-line-strong bg-surface px-2.5 py-2 text-[13.5px] text-ink",
    // Placeholders clear 4.5:1 against the surface; a lighter grey would not.
    "placeholder:text-ink-subtle disabled:opacity-60",
    "transition-colors duration-150 focus:border-heat-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heat/30",
    className,
  );

export function Input({ className, ...props }: ComponentPropsWithoutRef<"input">) {
  return <input className={inputStyles(className)} {...props} />;
}

export function Select({ className, ...props }: ComponentPropsWithoutRef<"select">) {
  return <select className={inputStyles(cn("h-9 pr-8", className))} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {/* Label above the input, always. Never a placeholder standing in for one. */}
      <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-fail-ink" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] leading-relaxed text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Inline form-level message: names the problem and the way out of it. */
export function FormMessage({ tone = "error", children }: { tone?: "error" | "info"; children: ReactNode }) {
  const tones = {
    error: "border-fail/30 bg-fail-wash text-fail-ink",
    info: "border-line bg-surface-muted text-ink-muted",
  } as const;
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cn("rounded-sharp border px-2.5 py-2 text-[12.5px] leading-relaxed", tones[tone])}>
      {children}
    </p>
  );
}
