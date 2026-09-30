"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react/ssr";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be blocked; the value stays selectable on screen.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sharp border border-line bg-surface px-2 py-1 text-[12px] font-medium text-ink-muted",
        "hover:bg-surface-muted hover:text-ink active:translate-y-px",
        className,
      )}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? <CheckIcon size={13} weight="bold" /> : <CopyIcon size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}
