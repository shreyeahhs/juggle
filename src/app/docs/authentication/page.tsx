import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Code, DocsPage, Li, Note, P, Section, Table, Ul } from "@/components/docs/prose";
import { getAppUrl } from "@/server/app-url";

export const metadata: Metadata = { title: "Authentication" };

export default async function AuthenticationDocsPage() {
  const baseUrl = await getAppUrl();

  return (
    <DocsPage
      title="Authentication"
      intro="Applications authenticate with a gateway token from your deployment's environment. Tokens are separate from your provider keys: they let an app use the gateway, never read the keys behind it."
    >
      <Section title="Sending the key">
        <P>
          Pass the key as a bearer token. <Code>x-api-key</Code> is also accepted for clients that prefer it. Cookies are ignored on <Code>/v1</Code>, so a
          browser session can never authorise API traffic.
        </P>
        <CodeBlock
          language="bash"
          code={`curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer $JUGGLE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"Hello"}]}'`}
        />
      </Section>

      <Section title="Key format">
        <P>
          Tokens are whatever you put in <Code>GATEWAY_API_KEYS</Code>. <Code>pnpm secrets:generate</Code> produces one shaped like <Code>gw_live_…</Code> with
          a checksum, which secret scanners can recognise if it ever leaks. They are compared in constant time and never written to the database.
        </P>
      </Section>

      <Section title="One token per application">
        <P>
          Name several tokens so you can tell apps apart in the request log and retire one without touching the others:
        </P>
        <CodeBlock language="bash" code={`GATEWAY_API_KEYS="prod=gw_live_...,dev=gw_live_...,ci=gw_live_..."`} />
        <Ul>
          <Li>
            <strong className="text-ink">Revoking</strong> means removing the entry and redeploying. It stops working the moment the new deployment is live.
          </Li>
          <Li>
            <strong className="text-ink">Rotating</strong> means adding the new token, moving your app over, then removing the old one.
          </Li>
          <Li>The name appears beside each request under Requests in the dashboard.</Li>
        </Ul>
      </Section>

      <Section title="Authentication errors">
        <Table
          head={["Status", "code", "Meaning"]}
          rows={[
            [<Code key="s">401</Code>, <Code key="c">missing_api_key</Code>, "No Authorization header was sent."],
            [<Code key="s">401</Code>, <Code key="c">invalid_api_key</Code>, "The token is not one of the configured tokens."],
            [<Code key="s">503</Code>, <Code key="c">no_tokens_configured</Code>, "The deployment has no GATEWAY_API_KEYS set."],
          ]}
        />
      </Section>

      <Note tone="warning">
        Keep gateway tokens on your server. They are bearer credentials: anyone holding one can spend your provider quota. Browser requests to <Code>/v1</Code>{" "}
        are blocked by default for that reason. See <Link href="/security" className="text-heat-ink hover:underline">Security</Link>.
      </Note>
    </DocsPage>
  );
}
