import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Code, DocsPage, Li, Note, P, Section, Table, Ul } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Configuring keys" };

export default function ProviderKeysDocsPage() {
  return (
    <DocsPage
      title="Configuring keys"
      intro="Both kinds of key live in your deployment's environment: the provider keys the gateway uses upstream, and the tokens your applications authenticate with."
    >
      <Section title="Provider keys">
        <P>
          Set <Code>GEMINI_API_KEYS</Code> to a comma-separated list. Entries can be named, and the name is what you will see in the dashboard:
        </P>
        <CodeBlock language="bash" code={`GEMINI_API_KEYS="AQ.Ab8...1,spare=AQ.Ab8...2,laptop=AQ.Ab8...3"`} />
        <P>
          Add as many as you like. Requests cycle through them one per request, so ten keys serve ten consecutive requests. Nothing is stored in the database
          but statistics, and the dashboard only ever shows a hint such as <Code>AQ.…E02</Code>.
        </P>
      </Section>

      <Section title="Gateway tokens">
        <P>
          Set <Code>GATEWAY_API_KEYS</Code> to the token your applications will send. Generate one with <Code>pnpm secrets:generate</Code>, or use any long
          random string. Multiple tokens let you tell apps apart in the request log and retire one without touching the others:
        </P>
        <CodeBlock language="bash" code={`GATEWAY_API_KEYS="prod=gw_live_...,dev=gw_live_..."`} />
      </Section>

      <Section title="Quota groups">
        <P>
          Google applies Gemini rate limits <strong className="text-ink">per Google Cloud project, not per API key</strong>. Keys created in the same project
          share one quota, so rotating between them gains nothing.
        </P>
        <P>
          Tell the gateway which project each key belongs to by naming it inline, as <Code>name@group=key</Code>. When the provider throttles one key, the whole
          group is parked at once, instead of the gateway rediscovering the same limit key by key:
        </P>
        <CodeBlock language="bash" code={`GEMINI_API_KEYS="a@project-1=AQ.Ab8...1,b@project-1=AQ.Ab8...2,c@project-2=AQ.Ab8...3"`} />
        <P>
          Keys from different projects must be in different groups. Putting them all in one would park keys that still have quota left, which costs you exactly
          the headroom the second project was for.
        </P>
        <P>
          If every key you have comes from a single project, <Code>GEMINI_QUOTA_GROUP</Code> sets one group for all of them and you can skip the inline form.
        </P>
        <Note>Ten keys in one project is still one quota. For real headroom, spread them across separate Google Cloud projects and group them accordingly.</Note>
      </Section>

      <Section title="Key health">
        <Table
          head={["Status", "What it means", "What happens next"]}
          rows={[
            ["Healthy", "Ready to serve requests.", "Used in rotation, least recently used first."],
            ["Rate limited", "The provider returned 429 for a specific model.", "Skipped for that model until the cooldown expires, then used again automatically."],
            ["Cooling down", "Repeated failures, or a permission error.", "Paused briefly, then retried automatically."],
            ["Degraded", "Recent failures but still usable.", "Used, but ranked below healthy keys."],
            ["Invalid", "The provider rejected the key.", "Never used again until you replace it and redeploy."],
          ]}
        />
      </Section>

      <Section title="Changing keys">
        <Ul>
          <Li>Edit the environment variable and redeploy. There is nothing to click.</Li>
          <Li>
            Statistics follow a key by a fingerprint of the secret, so renaming a key keeps its history, and re-adding a removed key picks it back up.
          </Li>
          <Li>Adding a key is safe at any time: it joins the rotation on the next request with a clean slate.</Li>
          <Li>Rotating at the provider? Add the new key alongside the old one, redeploy, then remove the old one. No request fails in between.</Li>
        </Ul>
      </Section>

      <Note tone="warning">
        Treat gateway tokens like passwords: anyone holding one can spend your provider quota. Keep them server-side, and see{" "}
        <Link href="/docs/authentication" className="text-heat-ink hover:underline">
          Authentication
        </Link>
        .
      </Note>
    </DocsPage>
  );
}
