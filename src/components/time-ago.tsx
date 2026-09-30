import { formatDateTime, timeAgo } from "@/lib/utils";

/**
 * Relative timestamp ("2 minutes ago").
 *
 * The server and the browser render this at slightly different moments, so the
 * text can legitimately differ by a second. `suppressHydrationWarning` keeps
 * that expected difference from being reported as a hydration error, and the
 * exact time is always available in the tooltip and `dateTime` attribute.
 */
export function TimeAgo({ value, className }: { value: Date | string | null | undefined; className?: string }) {
  if (!value) return <span className={className}>Never</span>;
  const date = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={date.toISOString()} title={formatDateTime(date)} className={className} suppressHydrationWarning>
      {timeAgo(date)}
    </time>
  );
}
