import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block";
import { Code, DocsPage, Li, Note, P, Section, Ul } from "@/components/docs/prose";
import { getAppUrl } from "@/server/app-url";

export const metadata: Metadata = { title: "Models" };

export default async function ModelsDocsPage() {
  const baseUrl = await getAppUrl();

  return (
    <DocsPage title="Models" intro="Which models you can call depends entirely on the provider keys you have added.">
      <Section title="Naming">
        <P>Three forms are accepted, and all resolve to the same upstream model:</P>
        <Ul>
          <Li>
            <Code>gemini-3.8-flash</Code>: the provider&rsquo;s own name.
          </Li>
          <Li>
            <Code>gemini/gemini-3.8-flash</Code>: provider-prefixed, unambiguous when several providers are configured.
          </Li>
          <Li>
            <Code>models/gemini-3.8-flash</Code>: Gemini&rsquo;s resource-style name.
          </Li>
        </Ul>
        <P>
          A model that no configured provider recognises returns <Code>400 model_not_supported</Code>, and a model the provider itself does not have returns{" "}
          <Code>404 model_not_found</Code>.
        </P>
      </Section>

      <Section title="Picking one that stays working">
        <P>
          Google retires model names, and a retired name starts returning <Code>404</Code> for accounts that never used it, even while it is still listed.
          Pinning a version is right for production, where you want the model to change only when you change it. For sample code and side projects, the moving
          aliases save you the maintenance:
        </P>
        <Ul>
          <Li>
            <Code>gemini-flash-latest</Code> and <Code>gemini-pro-latest</Code> always point at the current release.
          </Li>
          <Li>
            A pinned name such as <Code>gemini-3.8-flash</Code> keeps behaviour stable until you move it yourself.
          </Li>
        </Ul>
        <P>
          Either way, list the models your own keys can reach before hard-coding a name. Availability is per account, so another deployment&rsquo;s working model
          is not evidence that yours can call it.
        </P>
      </Section>

      <Section title="Listing models">
        <P>
          The gateway asks your provider for its current model list, so it is never a stale hard-coded list. Results are cached briefly. Models
          that cannot generate content (embedding-only models, for instance) are filtered out.
        </P>
        <CodeBlock language="bash" code={`curl ${baseUrl}/v1/models -H "Authorization: Bearer gw_live_your_key_here"`} />
      </Section>

      <Note>
        Model availability, pricing and quotas are the provider&rsquo;s, not ours. If a model is limited to certain regions or tiers on your provider account, the
        provider&rsquo;s own error is passed through so you can act on it.
      </Note>
    </DocsPage>
  );
}
