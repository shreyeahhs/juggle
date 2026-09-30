import type { Metadata } from "next";
import Link from "next/link";
import { CodeTabs } from "@/components/code-block";
import { KeyPerformanceTable } from "@/components/dashboard/key-performance";
import { RequestsTable } from "@/components/dashboard/requests-table";
import { Stat, StatStrip } from "@/components/dashboard/stat-strip";
import { UsageChart } from "@/components/dashboard/usage-chart";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { quickstartSamples } from "@/lib/examples";
import { formatDuration, formatNumber, percent } from "@/lib/utils";
import { getAppUrl } from "@/server/app-url";
import { requireOwner } from "@/server/auth/session";
import { getServices } from "@/server/container";
import type { UsageRange } from "@/server/services/stats";

export const metadata: Metadata = { title: "Overview" };

const RANGES: Array<{ value: UsageRange; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  await requireOwner("/dashboard");
  const { stats, config } = getServices();
  const requested = (await props.searchParams).range;
  const range: UsageRange = RANGES.some((option) => option.value === requested) ? (requested as UsageRange) : "24h";

  const [overview, usage, recent, keys] = await Promise.all([
    stats.overview(),
    stats.usage(range),
    stats.recent(8),
    stats.keyPerformance(config.providerKeys),
  ]);

  const ready = keys.filter((key) => key.health === "healthy").length;
  const unavailable = keys.filter((key) => key.health === "invalid" || key.health === "cooling_down" || key.health === "rate_limited").length;
  const configured = keys.length > 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
          <p className="text-[12.5px] text-ink-muted">
            {configured
              ? `${formatNumber(overview.requestsToday)} requests today across ${keys.length} key${keys.length === 1 ? "" : "s"}.`
              : "No provider keys configured yet."}
          </p>
        </div>
        <Button as={Link} href="/docs" variant="secondary" size="sm">
          Read the docs
        </Button>
      </header>

      {configured ? null : <Setup baseUrl={await getAppUrl()} />}

      <StatStrip>
        <Stat label="requests" value={formatNumber(overview.totalRequests, "compact")} hint={`${formatNumber(overview.requestsToday)} today`} />
        <Stat
          label="served"
          value={formatNumber(overview.successfulRequests, "compact")}
          hint={overview.totalRequests ? percent(overview.successfulRequests, overview.totalRequests) : "no traffic yet"}
        />
        <Stat
          label="failed"
          value={formatNumber(overview.failedRequests, "compact")}
          hot={overview.failedRequests > 0}
          hint={overview.totalRequests ? percent(overview.failedRequests, overview.totalRequests) : "no traffic yet"}
        />
        <Stat label="keys ready" value={`${ready}/${keys.length}`} hot={unavailable > 0} hint={unavailable ? `${unavailable} unavailable` : "all available"} />
        <Stat
          label="rate limits 24h"
          value={formatNumber(overview.rateLimitEvents24h)}
          hot={overview.rateLimitEvents24h > 0}
          hint="provider and gateway"
        />
        <Stat label="avg latency 24h" value={formatDuration(overview.avgLatencyMs)} hint={`${formatNumber(overview.tokensToday)} tokens today`} />
      </StatStrip>

      <Panel>
        <PanelHeader
          title="Requests over time"
          actions={
            <div className="flex items-center gap-px overflow-hidden rounded-sharp border border-line bg-line">
              {RANGES.map((option) => (
                <Link
                  key={option.value}
                  href={option.value === "24h" ? "/dashboard" : `/dashboard?range=${option.value}`}
                  aria-current={option.value === range ? "true" : undefined}
                  className={`px-2 py-1 font-mono text-[11px] ${option.value === range ? "bg-surface-muted text-ink" : "bg-surface text-ink-muted hover:text-ink"}`}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          }
        />
        <UsageChart points={usage} range={range} bucket={range === "24h" ? "hour" : "day"} />
      </Panel>

      <Panel>
        <PanelHeader
          title="Key rotation"
          description="Every key from GEMINI_API_KEYS, and how the rotation has been treating it."
          actions={
            <Button as={Link} href="/dashboard/keys" variant="ghost" size="sm">
              Details
            </Button>
          }
        />
        {configured ? (
          <KeyPerformanceTable keys={keys} compact />
        ) : (
          <EmptyState title="No provider keys configured" description="Set GEMINI_API_KEYS and redeploy." />
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Recent requests"
          description="Metadata only. Prompts and responses are never stored."
          actions={
            recent.length ? (
              <Button as={Link} href="/dashboard/requests" variant="ghost" size="sm">
                View all
              </Button>
            ) : null
          }
        />
        {recent.length ? (
          <RequestsTable rows={recent} compact />
        ) : (
          <EmptyState title="No requests yet" description="Once your application calls the gateway, every request shows up here." />
        )}
      </Panel>
    </div>
  );
}

/** Shown only until the deployment has keys, then it disappears for good. */
function Setup({ baseUrl }: { baseUrl: string }) {
  return (
    <Panel>
      <PanelHeader title="Finish setup" description="Two environment variables and you are running." />
      <PanelBody className="space-y-4">
        <ol className="space-y-2 text-[13px] leading-relaxed text-ink-muted">
          <li>
            <span className="font-mono text-heat-ink">1</span> Set <code className="font-mono text-[12px] text-ink">GEMINI_API_KEYS</code> to your
            comma-separated Gemini keys.
          </li>
          <li>
            <span className="font-mono text-heat-ink">2</span> Set <code className="font-mono text-[12px] text-ink">GATEWAY_API_KEYS</code> to the token your
            apps will send.
          </li>
          <li>
            <span className="font-mono text-heat-ink">3</span> Redeploy. Keys appear here on their own, with their own statistics.
          </li>
        </ol>
        <CodeTabs samples={quickstartSamples(baseUrl)} />
      </PanelBody>
    </Panel>
  );
}
