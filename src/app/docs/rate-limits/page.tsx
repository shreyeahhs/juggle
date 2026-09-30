import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocsPage, Li, Note, P, Section, Table, Ul } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Rate limits & failover" };

export default function RateLimitsDocsPage() {
  return (
    <DocsPage
      title="Rate limits & failover"
      intro="Two different limits apply to a request: the gateway's own limits, which protect the service, and the provider's limits, which the router works around on your behalf."
    >
      <Section title="Gateway limits">
        <P>
          These protect your own provider quota and bill. Every one is an environment variable; the defaults are below. Exceeding one returns <Code>429</Code>{" "}
          with a <Code>retry-after</Code> header.
        </P>
        <Table
          head={["Limit", "Default", "Scope"]}
          rows={[
            ["Requests per minute", "120", "per gateway token"],
            ["Requests per minute", "300", "whole deployment"],
            ["Requests per day", "20,000", "whole deployment"],
            ["Concurrent requests", "20", "whole deployment"],
            ["Request body size", "4 MiB", "per request"],
          ]}
        />
        <P>
          The remaining per-minute budget for your token is on every response in the <Code>x-ratelimit-*</Code> headers.
        </P>
      </Section>

      <Section title="Keys are cycled on every request">
        <P>
          The gateway does not drain one key until it fails. Each request goes to the least recently used healthy key, so traffic is spread evenly across the
          pool. With ten keys, ten consecutive requests use ten different keys. Spreading load is the cheapest way to avoid hitting a provider limit at all,
          which is what keeps your users from ever waiting on a retry.
        </P>
        <P>
          Under heavy concurrency several in-flight requests can still pick the same key before any of them finishes. Set{" "}
          <Code>GATEWAY_KEY_STRATEGY=power_of_two</Code> to trade a little evenness for fewer such collisions.
        </P>
      </Section>

      <Section title="Provider limits and how failover works">
        <P>
          Cycling makes a rate limit less likely; failover is what hides one when it happens anyway. When the provider rate-limits a key, the gateway does not
          pass that failure on if it can avoid it:
        </P>
        <Ul>
          <Li>The key is put on cooldown and the request is immediately retried with another key. Your application sees one successful response.</Li>
          <Li>
            The cooldown is <strong className="text-ink">scoped to the model</strong>, because providers meter quotas per model. A key exhausted on a Pro model
            keeps serving Flash.
          </Li>
          <Li>
            If the provider says how long to wait, that value is used. A per-minute limit cools down for about a minute; an exhausted{" "}
            <strong className="text-ink">daily</strong> quota cools down until the provider&rsquo;s quota actually resets (midnight Pacific time for Gemini)
            rather than being retried pointlessly all day.
          </Li>
          <Li>
            Keys sharing a <Link href="/docs/provider-keys" className="text-heat-ink hover:underline">quota group</Link> cool down together, since they draw on
            one quota.
          </Li>
          <Li>Cooldowns expire on their own. There is nothing to reset, and a recovered key rejoins the rotation automatically.</Li>
        </Ul>
      </Section>

      <Section title="Other failures">
        <Table
          head={["Provider response", "What the gateway does"]}
          rows={[
            ["429 rate limit", "Cools the key (and its quota group) for that model, rotates to another key immediately."],
            ["Invalid key", "Marks the key invalid so it is never tried again, rotates. Fix it and press Test to restore it."],
            ["403 permission denied", "Pauses that key briefly and flags it in the dashboard, rotates."],
            ["500 / timeout / network error", "Retries a small number of times, preferring a different key, with jittered backoff."],
            ["503 overloaded", "Retried with backoff, but not counted against the key: the provider is busy, not the key."],
            ["400 / 404 / failed precondition", "Returned to you immediately. Retrying cannot help, and it is not the key's fault."],
          ]}
        />
        <P>
          A key that keeps failing trips a circuit breaker and is paused with an increasing delay, so a broken key cannot slow every request. Attempts, retries
          and total time are all bounded, and the gateway never retries indefinitely.
        </P>
      </Section>

      <Note>
        If you regularly see <Code>all_keys_rate_limited</Code>, add another key, ideally from a different provider project, since keys in one project share
        one quota.
      </Note>
    </DocsPage>
  );
}
