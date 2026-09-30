import type { Metadata } from "next";
import { KeyPerformanceTable } from "@/components/dashboard/key-performance";
import { TimeAgo } from "@/components/time-ago";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader, EmptyState } from "@/components/ui/panel";
import { Code, Note, P } from "@/components/docs/prose";
import { formatDuration } from "@/lib/utils";
import { requireOwner } from "@/server/auth/session";
import { getServices } from "@/server/container";

export const metadata: Metadata = { title: "Keys" };

export default async function KeysPage() {
  await requireOwner("/dashboard/keys");
  const { stats, config } = getServices();
  const [keys, rateLimits] = await Promise.all([stats.keyPerformance(config.providerKeys), stats.recentRateLimits(10)]);

  const grouped = new Set(keys.map((key) => key.quotaGroup).filter(Boolean));

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Keys</h1>
        <p className="max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          Keys come from the <Code>GEMINI_API_KEYS</Code> environment variable, so there is nothing to manage here. Requests cycle through them one by one, and
          this is how each one has been performing.
        </p>
      </header>

      <Panel>
        <PanelHeader
          title="Provider keys"
          description={keys.length ? `${keys.length} configured, cycled one after another` : undefined}
        />
        {keys.length ? (
          <KeyPerformanceTable keys={keys} />
        ) : (
          <EmptyState
            title="No provider keys configured"
            description="Set GEMINI_API_KEYS to a comma-separated list of Gemini keys and redeploy. Keys appear here automatically."
          />
        )}
      </Panel>

      {keys.length && !grouped.size ? (
        <Note>
          If several of these keys come from the same Google Cloud project they share one quota, and rotating between them will not help. Name the project on
          each key, as <Code>name@project-1=AQ.Ab8…</Code>, so the gateway parks the whole group on a 429 instead of rediscovering the same limit key by key.
          Keys from different projects belong in different groups.
        </Note>
      ) : null}

      <Panel>
        <PanelHeader title="Recent rate limits" description="Upstream 429s from the provider, and any of the gateway's own limits." />
        {rateLimits.length ? (
          <ul className="divide-y divide-line">
            {rateLimits.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <span className="flex flex-wrap items-center gap-2 text-ink-muted">
                  <Badge tone={event.source === "upstream" ? "heat" : "neutral"}>{event.kind.replaceAll("_", " ")}</Badge>
                  {event.model ? <code className="font-mono text-[12px] text-ink-subtle">{event.model}</code> : null}
                  {event.retryAfterMs ? <span className="text-[12px] text-ink-subtle">waited {formatDuration(event.retryAfterMs)}</span> : null}
                </span>
                <span className="text-[12.5px] text-ink-subtle">
                  <TimeAgo value={event.createdAt} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No rate limits recorded" description="Nothing has been throttled yet." />
        )}
      </Panel>

      <P className="text-[12.5px]">
        Changing keys means editing the environment variable and redeploying. Statistics follow a key by its fingerprint, so they survive redeploys as long as
        the key itself stays configured.
      </P>
    </div>
  );
}
