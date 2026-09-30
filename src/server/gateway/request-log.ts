import type { Database } from "@/server/db/client";
import { rateLimitEvents, requests } from "@/server/db/schema";
import type { RequestOutcome } from "./errors";

/**
 * Metadata-only request records. By design there is no field for prompts,
 * completions, headers or keys, so they cannot be logged by accident.
 */
export interface RequestLogEntry {
  id: string;
  tokenLabel: string | null;
  providerKeyFingerprint: string | null;
  providerKeyHint: string | null;
  provider: string | null;
  model: string | null;
  endpoint: "chat.completions" | "models.list" | "models.retrieve";
  stream: boolean;
  statusCode: number;
  outcome: RequestOutcome;
  errorCode: string | null;
  attempts: number;
  latencyMs: number;
  ttfbMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  createdAt: Date;
}

export interface RateLimitEventEntry {
  tokenLabel: string | null;
  providerKeyFingerprint: string | null;
  source: "upstream" | "gateway";
  kind: string;
  provider: string | null;
  model: string | null;
  retryAfterMs: number | null;
  createdAt: Date;
}

export interface RequestLogSink {
  write(entry: RequestLogEntry, events: readonly RateLimitEventEntry[]): Promise<void>;
}

export class DrizzleRequestLogSink implements RequestLogSink {
  constructor(private readonly db: Database) {}

  async write(entry: RequestLogEntry, events: readonly RateLimitEventEntry[]): Promise<void> {
    await this.db.insert(requests).values(entry);
    if (events.length) {
      await this.db.insert(rateLimitEvents).values(
        events.map((event) => ({
          ...event,
          retryAfterMs: event.retryAfterMs === null ? null : Math.min(event.retryAfterMs, 2_000_000_000),
        })),
      );
    }
  }
}

export class MemoryRequestLogSink implements RequestLogSink {
  readonly entries: RequestLogEntry[] = [];
  readonly events: RateLimitEventEntry[] = [];

  async write(entry: RequestLogEntry, events: readonly RateLimitEventEntry[]): Promise<void> {
    this.entries.push(entry);
    this.events.push(...events);
  }
}
