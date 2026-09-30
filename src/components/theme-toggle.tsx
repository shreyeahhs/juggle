"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react/ssr";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "juggle-theme";

/**
 * Light/dark switch. The current theme lives in one place, the `dark` class on
 * <html>, applied before first paint by the inline script in the root layout,
 * so this component keeps no React state and cannot mismatch during hydration.
 * The preference is a per-browser convenience, which is what localStorage is for.
 */
export function ThemeToggle({ className }: { className?: string }) {
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Blocked storage (private window): the toggle still works for this page view.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn("inline-flex size-8 items-center justify-center rounded-sharp border border-line text-ink-muted hover:bg-surface-muted hover:text-ink", className)}
    >
      <span className="sr-only dark:hidden">Switch to dark theme</span>
      <span className="sr-only hidden dark:inline">Switch to light theme</span>
      <MoonIcon size={16} className="dark:hidden" />
      <SunIcon size={16} className="hidden dark:block" />
    </button>
  );
}
