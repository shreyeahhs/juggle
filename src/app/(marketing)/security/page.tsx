import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocsPage, Li, Note, P, Section, Ul } from "@/components/docs/prose";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
      <DocsPage
        title="Security model"
        intro="The gateway holds credentials that can spend real money, so the design assumes it will be attacked. This is what protects your keys, and what it cannot protect against."
      >
        <Section title="Where the keys live">
          <Ul>
            <Li>
              Provider keys are read from the deployment&rsquo;s <strong className="text-ink">environment variables</strong>, the same place your other service
              credentials live. They are never written to the database, so a database dump, a backup or a leaked connection string contains no key material.
            </Li>
            <Li>
              A key is held in memory only to make an upstream call. It is never returned to the browser, included in an API response, or written to a log.
            </Li>
            <Li>
              What the database does hold, keyed to each key, is a <strong className="text-ink">fingerprint</strong>: an HMAC of the secret using the
              deployment&rsquo;s own <Code>AUTH_SECRET</Code>. It identifies a key across restarts and cannot be turned back into one.
            </Li>
            <Li>
              The dashboard shows a hint like <Code>AQ.…E02</Code> and nothing more.
            </Li>
          </Ul>
        </Section>

        <Section title="Gateway tokens">
          <P>
            The tokens your applications send are also environment configuration. They are compared in constant time, never stored, and a malformed one is
            rejected before anything else happens. Repeated failures from one address are throttled.
          </P>
        </Section>

        <Section title="One owner">
          <P>
            A deployment has a single owner and a single password, and there is no sign-up. The dashboard session is a signed, http-only cookie carrying
            nothing but an expiry, so there are no sessions to steal from a database. Sign-in attempts are rate limited.
          </P>
        </Section>

        <Section title="Not an open proxy">
          <Ul>
            <Li>Every request to the API is authenticated. There is no anonymous access.</Li>
            <Li>
              Upstream hosts are fixed in code. The gateway will not fetch a URL supplied in a request, which keeps it from being used to reach internal
              services.
            </Li>
            <Li>Model names are validated against a strict pattern before being placed in an upstream URL.</Li>
            <Li>Per-token and deployment-wide rate limits, a daily cap, a concurrency limit, a body-size limit, bounded retries and request deadlines all apply.</Li>
          </Ul>
        </Section>

        <Section title="The web application">
          <Ul>
            <Li>
              Dashboard mutations run as Server Actions, which are POST-only and check the request origin against the host, so a third-party site cannot trigger
              them. The API at <Code>/v1</Code> ignores cookies entirely, so it has no ambient authority to abuse.
            </Li>
            <Li>
              A content security policy, <Code>frame-ancestors: none</Code>, nosniff, a strict referrer policy and HSTS in production are set on every response.
            </Li>
            <Li>Logs pass through a scrubber that redacts credential-shaped strings before a line is written.</Li>
          </Ul>
        </Section>

        <Section title="What this does not protect against">
          <P>Being explicit is more useful than a longer list of reassurances:</P>
          <Ul>
            <Li>
              <strong className="text-ink">A stolen gateway token</strong> can spend your provider quota until you remove it and redeploy. Treat one like a
              password and keep it server-side.
            </Li>
            <Li>
              <strong className="text-ink">Anyone who can read your deployment&rsquo;s environment</strong> can read your provider keys. That is true of every
              environment-configured service; restrict who can view your host&rsquo;s settings.
            </Li>
            <Li>
              <strong className="text-ink">The provider still sees your requests.</strong> A gateway changes who holds the key, not who processes the prompt.
            </Li>
          </Ul>
        </Section>

        <Note>
          Found a vulnerability? Please report it privately rather than opening a public issue. See <Code>SECURITY.md</Code> in the{" "}
          <a href={siteConfig.github} target="_blank" rel="noopener noreferrer" className="text-heat-ink hover:underline">
            repository
          </a>
          . Deployment hardening is covered in{" "}
          <Link href="/docs" className="text-heat-ink hover:underline">
            the docs
          </Link>
          .
        </Note>
      </DocsPage>
    </div>
  );
}
