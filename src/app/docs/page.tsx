import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, CodeTabs } from "@/components/code-block";
import { Walkthrough } from "@/components/walkthrough/player";
import { Code, DocsPage, Li, Note, P, Section, Ul } from "@/components/docs/prose";
import { quickstartSamples } from "@/lib/examples";
import { siteConfig } from "@/lib/site";
import { getAppUrl } from "@/server/app-url";

export const metadata: Metadata = { title: "Getting started" };

export default async function DocsIndexPage() {
  const baseUrl = await getAppUrl();

  return (
    <DocsPage
      title="Getting started"
      intro={`${siteConfig.name} is a bring-your-own-key gateway you run yourself. Your provider keys go in its environment; your applications call one OpenAI-compatible endpoint. The gateway cycles through the keys, and handles rate limits, cooldowns and failover for you.`}
    >
      <Section title="Watch it once">
        <P>The three steps, end to end. Jump to whichever one you are on.</P>
        <Walkthrough className="pt-1" />
      </Section>

      <Section title="The whole setup">
        <Ul>
          <Li>
            <strong className="text-ink">Deploy it.</strong> One click to Vercel, or a container anywhere. It needs a PostgreSQL URL for its statistics.
          </Li>
          <Li>
            <strong className="text-ink">Set the environment.</strong> Four variables, below.
          </Li>
          <Li>
            <strong className="text-ink">Point your client</strong> at <Code>{baseUrl}/v1</Code> with your gateway token.
          </Li>
        </Ul>
        <CodeBlock
          language="bash"
          code={`AUTH_SECRET="..."                  # pnpm secrets:generate
OWNER_PASSWORD="..."               # your dashboard password
GEMINI_API_KEYS="AQ.Ab8...1,AQ.Ab8...2"  # as many as you like
GATEWAY_API_KEYS="gw_live_..."     # what your apps send
DATABASE_URL="postgres://..."      # statistics and cooldowns`}
        />
      </Section>

      <Section title="Your first request">
        <P>The gateway speaks the OpenAI Chat Completions format, so the official OpenAI SDKs work unchanged: only the API key and base URL differ.</P>
        <CodeTabs samples={quickstartSamples(baseUrl)} />
      </Section>

      <Section title="What happens to a request">
        <Ul>
          <Li>The token is checked against <Code>GATEWAY_API_KEYS</Code>, and your rate limits are applied.</Li>
          <Li>The request is validated and translated into the provider&rsquo;s own format.</Li>
          <Li>
            The least recently used healthy key is chosen, so traffic spreads evenly across the pool instead of draining one key.
          </Li>
          <Li>
            If the provider throttles or rejects that key, the gateway cools it down and retries on another one inside the same request. See{" "}
            <Link href="/docs/rate-limits" className="text-heat-ink hover:underline">
              Rate limits and failover
            </Link>
            .
          </Li>
          <Li>The answer comes back in OpenAI format, and only metadata is recorded: never your prompt or the response.</Li>
        </Ul>
      </Section>

      <Note>
        You supply the provider keys, so you keep your own quotas, billing and terms. {siteConfig.name} adds no AI capacity of its own, and each deployment
        belongs to one person.
      </Note>
    </DocsPage>
  );
}
