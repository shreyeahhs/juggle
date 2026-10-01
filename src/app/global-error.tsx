"use client";

import { themeScript } from "@/lib/theme-script";
import "./globals.css";

/**
 * Last-resort boundary, for a failure above every other one -- including in a
 * layout. It replaces the root layout rather than nesting inside it, so it has
 * to supply its own <html> and <body>, its own stylesheet, and its own copy of
 * the theme script. Next.js has a built-in fallback for this case, but that one
 * carries none of the above, which is why an uncaught error used to drop the
 * page back to the light theme.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <title>Something went wrong · Juggle</title>
      </head>
      <body className="min-h-full bg-canvas text-ink antialiased">
        <div className="mx-auto flex min-h-dvh max-w-xl items-center px-5">
          <div className="w-full rounded-sharp border border-line bg-surface">
            <div className="border-b border-line bg-surface-muted/60 px-4 py-2">
              <span className="font-mono text-[11px] text-fail">unhandled error</span>
            </div>

            <div className="space-y-4 px-4 py-5">
              <h1 className="text-[15px] font-medium text-ink">Something went wrong.</h1>
              <p className="text-[13.5px] leading-relaxed text-ink-muted">
                This is the dashboard, not the gateway. Requests to <code className="font-mono text-[12.5px] text-ink">/v1</code> are served by a separate route
                that does not depend on this page, so your applications are unaffected.
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
      </body>
    </html>
  );
}
