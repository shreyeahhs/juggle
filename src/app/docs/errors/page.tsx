import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Code, DocsPage, Li, Note, P, Section, Table, Ul } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Errors" };

export default function ErrorsDocsPage() {
  return (
    <DocsPage
      title="Errors"
      intro="Errors use OpenAI's envelope, so SDK error types, status codes and automatic retries behave exactly as they would against OpenAI."
    >
      <Section title="Shape">
        <CodeBlock
          language="json"
          code={`{
  "error": {
    "message": "All 3 active Google Gemini keys are rate-limited or cooling down for gemini-3.8-flash. The earliest becomes available in ~42s.",
    "type": "rate_limit_error",
    "code": "all_keys_rate_limited",
    "param": null,
    "request_id": "req_8eaa4751f385494784981c450bb8ec64"
  }
}`}
        />
        <P>
          <Code>param</Code> names the offending field for validation errors, and <Code>request_id</Code> matches the row in your dashboard.
        </P>
      </Section>

      <Section title="Gateway errors">
        <Table
          head={["Status", "code", "Meaning and what to do"]}
          rows={[
            [<Code key="s">400</Code>, <Code key="c">invalid_request</Code>, <>The body failed validation; <Code key="p">param</Code> says which field. Fix and resend.</>],
            [<Code key="s">400</Code>, <Code key="c">invalid_json</Code>, "The body was not valid JSON."],
            [<Code key="s">400</Code>, <Code key="c">model_not_supported</Code>, "No configured provider serves that model."],
            [<Code key="s">400</Code>, <Code key="c">unsupported_parameter</Code>, "A parameter the gateway cannot honour yet. Remove it."],
            [<Code key="s">400</Code>, <Code key="c">no_provider_keys</Code>, "No keys are configured for this provider. Set GEMINI_API_KEYS and redeploy."],
            [<Code key="s">400</Code>, <Code key="c">no_active_provider_keys</Code>, "Every configured key was rejected by the provider as invalid."],
            [<Code key="s">400</Code>, <Code key="c">provider_rejected_request</Code>, "The provider refused the request itself. The message is passed through."],
            [<Code key="s">401</Code>, "several", <>See <Link key="l" href="/docs/authentication" className="text-heat-ink hover:underline">Authentication</Link>.</>],
            [<Code key="s">404</Code>, <Code key="c">model_not_found</Code>, "The provider does not have that model."],
            [<Code key="s">413</Code>, <Code key="c">request_too_large</Code>, "The body exceeded the configured size limit."],
            [<Code key="s">415</Code>, <Code key="c">unsupported_media_type</Code>, <>Send <Code key="ct">Content-Type: application/json</Code>.</>],
            [<Code key="s">429</Code>, <Code key="c">rate_limit_exceeded</Code>, <>One of your own configured limits. Respect <Code key="r">retry-after</Code>.</>],
            [<Code key="s">429</Code>, <Code key="c">daily_quota_exceeded</Code>, "The deployment reached its daily request limit."],
            [<Code key="s">429</Code>, <Code key="c">concurrency_limit_exceeded</Code>, "Too many requests in flight at once; retry shortly."],
            [<Code key="s">429</Code>, <Code key="c">all_keys_rate_limited</Code>, "Every usable key is cooling down. Add another key, or wait for retry-after."],
            [<Code key="s">502</Code>, <Code key="c">upstream_error</Code>, "The provider failed repeatedly. Safe to retry."],
            [<Code key="s">503</Code>, <Code key="c">upstream_overloaded</Code>, "The provider is overloaded. Retry with backoff."],
            [<Code key="s">503</Code>, <Code key="c">attempts_exhausted</Code>, "The attempt budget ran out while usable keys remained. Retry."],
            [<Code key="s">504</Code>, <Code key="c">upstream_timeout</Code>, "The provider did not answer in time."],
          ]}
        />
      </Section>

      <Section title="Which errors are worth retrying">
        <Ul>
          <Li>
            <strong className="text-ink">Already retried for you:</strong> provider rate limits, rejected keys, and transient upstream failures. By the time you
            see a 429 or 502, the gateway has exhausted the keys it could use.
          </Li>
          <Li>
            <strong className="text-ink">Retry with backoff:</strong> 429, 502, 503 and 504. Honour <Code>retry-after</Code> when present. The OpenAI SDKs do
            this automatically.
          </Li>
          <Li>
            <strong className="text-ink">Never retry:</strong> 400, 401, 403, 404 and 413. Nothing about the next attempt will differ.
          </Li>
        </Ul>
      </Section>

      <Note>
        Provider messages are passed through when they help you (a malformed argument, an unknown model) and replaced with a neutral message when they might
        leak key or project details. Nothing in an error response ever contains a provider key.
      </Note>
    </DocsPage>
  );
}
