import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocsPage, P, Section } from "@/components/docs/prose";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = { title: "FAQ" };

export default function FaqPage() {
  return (
    <DocsPage title="Frequently asked questions">
      <Section title="Does this give me free AI access?">
        <P>
          No. {siteConfig.name} has no models and no inference capacity of its own. Every request is served by a provider key that you supplied, billed to your
          own provider account under that provider&rsquo;s terms. What the gateway adds is key storage, rotation and failover.
        </P>
      </Section>

      <Section title="Where are my provider keys stored?">
        <P>
          In your deployment&rsquo;s environment variables, and nowhere else. The database holds only usage statistics and a keyed fingerprint that identifies
          a key without being reversible, so a database dump contains nothing worth stealing.
        </P>
      </Section>

      <Section title="Can anyone else use my keys?">
        <P>
          Only someone holding one of your gateway tokens, or able to read your deployment&rsquo;s environment. There are no other accounts on your instance:
          sign-in is a single password that you set.
        </P>
      </Section>

      <Section title="Do you store my prompts?">
        <P>
          No. Only metadata: time, model, status, latency, token counts and which key served the request. There is no column in the database for a prompt or a
          response. See{" "}
          <Link href="/privacy" className="text-heat-ink hover:underline">
            Privacy
          </Link>
          .
        </P>
      </Section>

      <Section title="Why did my request take two attempts?">
        <P>
          Because the first key was rate-limited or rejected and the gateway rotated to another, which is failover working. The{" "}
          <Code>x-juggle-attempts</Code> header reports it, and the dashboard shows which keys were involved.
        </P>
      </Section>

      <Section title="Is rotating between keys from one Google project useful?">
        <P>
          No. Gemini quotas are per Google Cloud project, so keys from one project share a limit. Set <Code>GEMINI_QUOTA_GROUP</Code> so the gateway does not
          waste attempts, and create keys in separate projects if you want more headroom.
        </P>
      </Section>

      <Section title="Which providers are supported?">
        <P>
          Google Gemini today. The provider layer is an interface with pluggable adapters, and the request format is already OpenAI-shaped, so
          OpenAI-compatible providers are mostly configuration. Anthropic and Gemini-style providers need a translating adapter like the Gemini one.
        </P>
      </Section>

      <Section title="Can I self-host it?">
        <P>
          That is the only way it runs. It is open source, deploys to Vercel in a click or to any container host, and needs a PostgreSQL URL plus a few
          environment variables. See the{" "}
          <a href={siteConfig.github} target="_blank" rel="noopener noreferrer" className="text-heat-ink hover:underline">
            repository
          </a>
          .
        </P>
      </Section>

      <Section title="What happens if the gateway is down?">
        <P>
          Your applications cannot reach the provider through it; that is the trade-off of any proxy. It is stateless apart from PostgreSQL, so you can run
          several instances behind a load balancer and they share key health through the database.
        </P>
      </Section>
    </DocsPage>
  );
}
