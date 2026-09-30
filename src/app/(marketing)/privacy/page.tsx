import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocsPage, Li, Note, P, Section, Table, Ul } from "@/components/docs/prose";
import { siteConfig } from "@/lib/site";
import { getServices } from "@/server/container";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  const retentionDays = getServices().config.requestLogRetentionDays;

  return (
    <div className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
      <DocsPage
        title="Privacy"
        intro={`What ${siteConfig.name} stores, what it deliberately does not, and how long any of it is kept. Each deployment belongs to one person, who runs it on their own infrastructure.`}
      >
        <Section title="Prompts and responses are not stored">
          <P>
            The gateway forwards your request to the provider and returns the answer. Neither is written to the database, and there is no table or column that
            could hold one. This is structural, not a setting: a bug cannot accidentally persist a prompt somewhere that does not exist.
          </P>
          <P>If prompt logging is ever added, it will be explicitly opt-in and clearly labelled.</P>
        </Section>

        <Section title="What is stored">
          <Table
            head={["Data", "Why", "Retention"]}
            rows={[
              ["Request metadata", "Usage charts and debugging.", `${retentionDays} days, then deleted.`],
              ["Per-key statistics", "The key-performance view: counts, cooldowns, last used.", "While the key stays configured."],
              ["Rate-limit events", "Explaining why a request was throttled.", `${retentionDays} days, then deleted.`],
              ["Rate-limit counters", "Enforcing per-minute and daily limits.", "Two days."],
            ]}
          />
          <P>
            Request metadata means: timestamp, which gateway token, provider, model, HTTP status, outcome, latency, attempt count, token counts and the hint
            (for example <Code>AQ.…E02</Code>) of the key that served it.
          </P>
        </Section>

        <Section title="What is never stored">
          <Ul>
            <Li>Prompts, completions, system instructions or any other request or response content.</Li>
            <Li>
              Provider keys and gateway tokens. Both live in the environment, not the database; only a keyed fingerprint and a display hint are persisted.
            </Li>
            <Li>
              Authorization headers. Application logs pass through a scrubber that redacts anything shaped like a credential before a line is written.
            </Li>
            <Li>Accounts, email addresses or personal details. There is no sign-up, and no user table.</Li>
            <Li>Third-party analytics or tracking of any kind. These pages load nothing from outside the deployment.</Li>
          </Ul>
        </Section>

        <Section title="Who can see it">
          <P>
            Only whoever holds the dashboard password: the person running the deployment. Your AI provider sees the requests the gateway forwards, under its own
            privacy policy; Juggle does not change that relationship.
          </P>
        </Section>

        <Section title="Deleting it">
          <P>
            Removing a key from the environment stops it being used immediately. <Code>pnpm db:prune</Code> deletes metadata past the retention window, and
            dropping the database removes everything, since nothing else is kept anywhere.
          </P>
        </Section>

        <Note>
          This describes the software. If you are using someone else&rsquo;s deployment, its operator controls the data.{" "}
          <Link href="/docs" className="text-heat-ink hover:underline">
            Run your own
          </Link>{" "}
          and none of it leaves your infrastructure.
        </Note>
      </DocsPage>
    </div>
  );
}
