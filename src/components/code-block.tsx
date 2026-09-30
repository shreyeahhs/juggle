"use client";

import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

export interface CodeSample {
  label: string;
  language: string;
  code: string;
}

export function CodeBlock({ code, language, className }: { code: string; language?: string; className?: string }) {
  return (
    <div className={cn("group relative overflow-hidden rounded-sharp border border-line bg-surface-muted/60", className)}>
      <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 text-[12.5px] leading-relaxed">
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}

/** Tabbed examples (cURL / JavaScript / Python). */
export function CodeTabs({ samples, className }: { samples: CodeSample[]; className?: string }) {
  const [active, setActive] = useState(0);
  const sample = samples[active] ?? samples[0];
  if (!sample) return null;

  return (
    <div className={cn("overflow-hidden rounded-sharp border border-line bg-surface-muted/60", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1.5">
        <div role="tablist" aria-label="Code examples" className="flex gap-1">
          {samples.map((item, index) => (
            <button
              key={item.label}
              role="tab"
              type="button"
              aria-selected={index === active}
              onClick={() => setActive(index)}
              className={cn(
                "rounded-sharp px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                index === active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <CopyButton value={sample.code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 text-[12.5px] leading-relaxed">
        <code>{sample.code}</code>
      </pre>
    </div>
  );
}
