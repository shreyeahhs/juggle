/**
 * Exists to create a Suspense boundary around the dashboard.
 *
 * Without one, a Server Component that throws during the initial render takes
 * the whole document with it: there is nothing for React to stream a fallback
 * into, so Next.js serves its built-in `__next_error__` document instead. That
 * document carries no class on <html>, which is why a failed query used to come
 * back in the light theme no matter what the visitor had chosen.
 *
 * With a boundary here, the shell flushes first and `error.tsx` can take over
 * inside it, keeping the real document, the stylesheet and the theme.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="h-8 w-40 animate-pulse rounded-sharp bg-surface-muted" />

      {/* Matches the stat strip's hairline lattice so the layout does not jump. */}
      <div className="grid gap-px overflow-hidden rounded-sharp border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-2 bg-surface px-3 py-3">
            <div className="h-2.5 w-14 animate-pulse rounded-sharp bg-surface-muted" />
            <div className="h-5 w-12 animate-pulse rounded-sharp bg-surface-muted" />
          </div>
        ))}
      </div>

      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-sharp border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <div className="h-3.5 w-32 animate-pulse rounded-sharp bg-surface-muted" />
          </div>
          <div className="h-40 animate-pulse bg-surface-muted/30" />
        </div>
      ))}
    </div>
  );
}
