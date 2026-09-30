CREATE TYPE "public"."provider_key_status" AS ENUM('active', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."request_outcome" AS ENUM('success', 'client_error', 'rate_limited', 'no_keys', 'upstream_error', 'timeout', 'cancelled', 'internal_error');--> statement-breakpoint
CREATE TABLE "provider_key_cooldowns" (
	"fingerprint" text NOT NULL,
	"model" text NOT NULL,
	"cooldown_until" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"quota_scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_key_cooldowns_fingerprint_model_pk" PRIMARY KEY("fingerprint","model")
);
--> statement-breakpoint
CREATE TABLE "provider_keys" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"key_hint" text NOT NULL,
	"status" "provider_key_status" DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"cooldown_until" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"request_count" bigint DEFAULT 0 NOT NULL,
	"success_count" bigint DEFAULT 0 NOT NULL,
	"error_count" bigint DEFAULT 0 NOT NULL,
	"rate_limit_count" bigint DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_counters_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key_fingerprint" text,
	"token_label" text,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text,
	"model" text,
	"retry_after_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_label" text,
	"provider_key_fingerprint" text,
	"provider_key_hint" text,
	"provider" text,
	"model" text,
	"endpoint" text NOT NULL,
	"stream" boolean DEFAULT false NOT NULL,
	"status_code" integer NOT NULL,
	"outcome" "request_outcome" NOT NULL,
	"error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"ttfb_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"reasoning_tokens" integer,
	"total_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_key_cooldowns" ADD CONSTRAINT "provider_key_cooldowns_fingerprint_provider_keys_fingerprint_fk" FOREIGN KEY ("fingerprint") REFERENCES "public"."provider_keys"("fingerprint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_keys_provider_status_idx" ON "provider_keys" USING btree ("provider","status");--> statement-breakpoint
CREATE INDEX "rate_limit_counters_window_idx" ON "rate_limit_counters" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "rate_limit_events_created_idx" ON "rate_limit_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "requests_created_idx" ON "requests" USING btree ("created_at" DESC NULLS LAST);