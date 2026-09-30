import type { Metadata } from "next";
import { RequestsTable } from "@/components/dashboard/requests-table";
import { Panel, PanelHeader, EmptyState } from "@/components/ui/panel";
import { requireOwner } from "@/server/auth/session";
import { getServices } from "@/server/container";

export const metadata: Metadata = { title: "Requests" };

export default async function RequestsPage() {
  await requireOwner("/dashboard/requests");
  const services = getServices();
  const rows = await services.stats.recent(100);

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Requests</h1>
        <p className="max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          The last 100 requests. Juggle records metadata only: timing, status, model, token counts and which key served the request. Prompts and responses are
          never stored.
        </p>
      </header>

      <Panel>
        <PanelHeader title="Recent activity" description={`Logs are kept for ${services.config.requestLogRetentionDays} days.`} />
        {rows.length ? (
          <RequestsTable rows={rows} />
        ) : (
          <EmptyState title="No requests yet" description="Send a request through the gateway and it will appear here." />
        )}
      </Panel>
    </div>
  );
}
