import Link from "next/link";
import { CodeTabs } from "@/components/code-block";
import { PoolReadout } from "@/components/marketing/pool-readout";
import { Button } from "@/components/ui/button";
import { Walkthrough } from "@/components/walkthrough/player";
import { quickstartSamples } from "@/lib/examples";
import { siteConfig } from "@/lib/site";
import { getAppUrl } from "@/server/app-url";

/*
 * Layout note: no section on this page repeats another's structure, and none of
 * them is a grid of identical cards. Grouping is done with rules and columns,
 * the way a technical document does it. There are no eyebrow labels: every
 * heading carries its own weight.
 */

const PROVIDERS = [
  { name: "Google Gemini", status: "Available", note: "Chat completions, streaming, model listing" },
  { name: "OpenAI", status: "Planned", note: "Native format, so little translation is needed" },
  { name: "Anthropic", status: "Planned", note: "Messages API" },
  { name: "Groq", status: "Planned", note: "OpenAI-compatible" },
  { name: "OpenRouter", status: "Planned", note: "OpenAI-compatible" },
  { name: "Mistral", status: "Planned", note: "OpenAI-compatible" },
];

const GUARANTEES = [
  {
    title: "Your keys never reach the database",
    body: "Provider keys live in your deployment's environment, next to your other service credentials. The database stores a one-way fingerprint so statistics survive a redeploy, which means a database dump holds nothing worth stealing.",
  },
  {
    title: "Keys are never echoed back",
    body: "The dashboard shows a hint like AQ.…E02 and nothing more. Credential-shaped strings are scrubbed from every log line and from every error the gateway returns, including the ones a provider sends back.",
  },
  {
    title: "Never an open proxy",
    body: "Every request is authenticated against tokens you set, then rate limited per token and across the deployment. Upstream hosts are fixed in the adapter code, so no request body can redirect the gateway somewhere else.",
  },
  {
    title: "Prompts are not stored",
    body: "There is no column for a prompt or a response, so there is nothing to leak and nothing to turn off. Usage records hold timing, status, model and token counts.",
  },
];

export default async function LandingPage() {
  const baseUrl = await getAppUrl();
  const samples = quickstartSamples(baseUrl);

  return (
    <>
      {/* 1. Hero: asymmetric split, copy against a still readout of the real table. */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 pt-14 pb-16 sm:px-8 lg:grid-cols-12 lg:gap-12 lg:pt-20">
          <div className="flex min-w-0 flex-col justify-center gap-6 lg:col-span-6">
            <h1 className="display text-[2.5rem] leading-[1.03] font-semibold md:text-5xl lg:text-[3.5rem]">
              Ten API keys behind one endpoint.
            </h1>
            <p className="max-w-lg text-[15.5px] leading-relaxed text-ink-muted">
              Juggle cycles your provider keys on every request, absorbs the rate limits, and hands your app one clean response.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button as="a" href={siteConfig.github} target="_blank" rel="noopener noreferrer" size="lg">
                Deploy your own
              </Button>
              <Button as={Link} href="/docs" variant="secondary" size="lg">
                Read the docs
              </Button>
            </div>
          </div>

          <div className="min-w-0 lg:col-span-6 lg:pl-4">
            <PoolReadout />
          </div>
        </div>
      </section>

      {/* 2. Walkthrough: the page's one authored moment. Stage plus a note column. */}
      <section className="border-b border-line bg-surface-muted/25">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <h2 className="display max-w-lg text-[1.75rem] font-semibold md:text-[2rem]">The whole setup, start to finish.</h2>
          <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-muted">
            Two environment variables and one line in your client. Play it through, or jump to the step you need.
          </p>
          <Walkthrough className="mt-9" />
        </div>
      </section>

      {/* 3. Quickstart: a narrow, centred reading column. */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
          <h2 className="display text-[1.75rem] font-semibold md:text-[2rem]">Two lines of your code change.</h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">
            The gateway speaks the OpenAI Chat Completions format, so the official SDKs work without a patch or a wrapper. Swap the base URL and the key.
          </p>
          <CodeTabs className="mt-6" samples={samples} />
        </div>
      </section>

      {/* 4. The mechanic: prose on the left, a printed request trace on the right. */}
      <section className="border-b border-line bg-surface-muted/25">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:gap-14">
          <div className="min-w-0">
            <h2 className="display text-[1.75rem] font-semibold md:text-[2rem]">What happens when a key is throttled.</h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">
              Your application never sees the 429. The gateway puts that key on a cooldown and retries the same request on another key straight away.
            </p>

            <dl className="mt-7 space-y-5">
              <div>
                <dt className="text-[14px] font-medium text-ink">Cooldowns that match reality</dt>
                <dd className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
                  A per-minute limit waits a minute. An exhausted daily quota waits until the provider actually resets it, at midnight Pacific, instead of
                  retrying all day. When a provider sends a retry delay, that number is used rather than a guess.
                </dd>
              </div>
              <div>
                <dt className="text-[14px] font-medium text-ink">Scoped per model, not per key</dt>
                <dd className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
                  Providers meter quotas per model, so a key that is exhausted on Pro keeps serving Flash instead of sitting idle.
                </dd>
              </div>
              <div>
                <dt className="text-[14px] font-medium text-ink">Aware of shared quotas</dt>
                <dd className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
                  Gemini meters per Google Cloud project, not per key. Group the keys that share a project and the gateway stops spending attempts on a quota it
                  already knows is spent.
                </dd>
              </div>
            </dl>
          </div>

          <div className="min-w-0 lg:pt-2">
            <div className="overflow-hidden rounded-sharp border border-line bg-surface">
              <div className="border-b border-line bg-surface-muted/60 px-3 py-2">
                <span className="font-mono text-[11px] text-ink-subtle">one request, as the gateway records it</span>
              </div>
              <pre className="overflow-x-auto px-3 py-3 font-mono text-[11.5px] leading-[1.8] sm:px-4">
                <code>
                  <span className="text-ink">POST /v1/chat/completions</span>
                  {"\n"}
                  <span className="text-ink-subtle">model gemini-3.8-flash{"\n\n"}</span>
                  <span className="text-ink-muted">attempt 1 </span>
                  <span className="text-ink">spare-2 </span>
                  <span className="text-heat-ink">429 </span>
                  <span className="text-ink-subtle">quota exhausted, retry in 17s{"\n"}</span>
                  <span className="text-ink-muted">attempt 2 </span>
                  <span className="text-ink">spare-3 </span>
                  <span className="text-ink">200 </span>
                  <span className="text-ink-subtle">412 ms</span>
                </code>
              </pre>
              <div className="space-y-1 border-t border-line px-3 py-2.5 font-mono text-[11px] sm:px-4">
                <p className="text-ink">200 OK</p>
                <p className="text-ink-subtle">x-juggle-attempts: 2</p>
              </div>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-subtle">
              One response, no retry loop in your code, and a record of which key served it.
            </p>
          </div>
        </div>
      </section>

      {/* 5. Providers: a plain table. Six rows do not need six cards. */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
          <h2 className="display text-[1.75rem] font-semibold md:text-[2rem]">Providers.</h2>
          <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-muted">
            Gemini today. A provider is an adapter behind one interface, and the internal request format is already OpenAI-shaped, so most of the remaining work
            is error mapping.
          </p>

          <table className="mt-7 w-full text-left">
            <thead>
              <tr className="border-b border-line-strong font-mono text-[10.5px] text-ink-subtle">
                <th scope="col" className="py-2 pr-4 font-normal">
                  provider
                </th>
                <th scope="col" className="py-2 pr-4 font-normal">
                  status
                </th>
                <th scope="col" className="hidden py-2 font-normal sm:table-cell">
                  notes
                </th>
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.map((provider) => {
                const available = provider.status === "Available";
                return (
                  <tr key={provider.name} className="border-b border-line">
                    <td className="py-2.5 pr-4 text-[13.5px] font-medium text-ink">{provider.name}</td>
                    <td className={`py-2.5 pr-4 font-mono text-[11.5px] ${available ? "text-heat-ink" : "text-ink-subtle"}`}>{provider.status}</td>
                    <td className="hidden py-2.5 text-[13px] text-ink-muted sm:table-cell">{provider.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 6. Security: four statements divided by rules, not boxed into cards. */}
      <section className="border-b border-line bg-surface-muted/25">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <h2 className="display max-w-xl text-[1.75rem] font-semibold md:text-[2rem]">Keys you cannot afford to leak.</h2>

          {/*
            Two columns of four statements. The rule between columns is drawn on
            the second cell of each row rather than with `divide-x`, which would
            also draw one at the start of the wrapped row.
          */}
          <div className="mt-9 grid border-t border-line sm:grid-cols-2">
            {GUARANTEES.map((item) => (
              <div
                key={item.title}
                className="border-b border-line py-6 sm:[&:nth-child(even)]:border-l sm:[&:nth-child(even)]:pl-7 sm:[&:nth-child(odd)]:pr-7"
              >
                <h3 className="text-[14.5px] font-medium text-ink">{item.title}</h3>
                <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-muted">{item.body}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 max-w-2xl text-[13px] leading-relaxed text-ink-subtle">
            Anyone who can read your deployment&rsquo;s environment can read the keys, exactly as with any environment-configured service. That trade is what
            removes the encrypted vault and its key-rotation machinery, and it is written down rather than hidden. The{" "}
            <Link href="/security" className="text-heat-ink underline decoration-heat/40 hover:decoration-heat">
              security page
            </Link>{" "}
            lists what is in scope.
          </p>
        </div>
      </section>

      {/* 7. Closing statement: one column, the plainest thing on the page. */}
      <section>
        <div className="mx-auto max-w-2xl px-5 py-20 sm:px-8">
          <h2 className="display text-[1.75rem] font-semibold md:text-[2rem]">What Juggle is not.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
            It has no models and no inference capacity of its own. Every request is served by a provider key you supplied and billed to your own provider
            account. Nothing is resold, and there is no account to create: one deployment belongs to one person, and that person is whoever set the environment
            variables.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <Button as="a" href={siteConfig.github} target="_blank" rel="noopener noreferrer" size="lg">
              Deploy your own
            </Button>
            <Button as={Link} href="/docs" variant="secondary" size="lg">
              Read the docs
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
