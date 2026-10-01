"use client";

/**
 * Error boundary for the dashboard.
 *
 * Without one, a failed query takes out the whole document: Next.js falls back
 * to its built-in error page, which renders its own <html> and so loses the
 * root layout, the stylesheet and the inline theme script. The visible symptom
 * is the page reverting to the light theme, which reads as a theming bug rather
 * than the database error it actually is.
 *
 * Catching it here keeps the real document, so the theme and the dashboard
 * shell survive and the failure stays the size of the panel it happened in.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-sharp border border-line bg-surface">
        <div className="border-b border-line bg-surface-muted/60 px-4 py-2">
          <span className="font-mono text-[11px] text-fail">dashboard unavailable</span>
        </div>

        <div className="space-y-4 px-4 py-5">
          <div className="space-y-2">
            <h1 className="text-[15px] font-medium text-ink">This page could not load its data.</h1>
            <p className="text-[13.5px] leading-relaxed text-ink-muted">
              The gateway itself is unaffected: <code className="font-mono text-[12.5px] text-ink">/v1</code> keeps serving requests, because it does not depend on
              this page. What failed is reading the statistics.
            </p>
          </div>

          <p className="text-[13px] leading-relaxed text-ink-subtle">
            This is nearly always the database connection. Check that <code className="font-mono text-[12px] text-ink-muted">DATABASE_URL</code> is reachable and
            that its password is percent-encoded, then reload.
          </p>

          {error.digest ? (
            <p className="font-mono text-[11.5px] text-ink-subtle">
              digest <span className="text-ink-muted">{error.digest}</span> &middot; search your host&rsquo;s runtime logs for it
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-8 items-center rounded-sharp bg-ink px-3 text-[13px] font-medium text-canvas hover:opacity-90"
            >
              Try again
            </button>
            <a
              href="/api/health"
              className="inline-flex h-8 items-center rounded-sharp border border-line px-3 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              Check database health
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
