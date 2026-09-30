import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Code, DocsPage, Li, Note, P, Section, Table, Ul } from "@/components/docs/prose";
import { getAppUrl } from "@/server/app-url";

export const metadata: Metadata = { title: "Using the API" };

export default async function ApiDocsPage() {
  const baseUrl = await getAppUrl();

  return (
    <DocsPage
      title="Using the API"
      intro="The gateway implements the OpenAI Chat Completions API. Point an OpenAI client at it, or call it with plain HTTP."
    >
      <Section title="Endpoints">
        <Table
          head={["Method", "Path", "Purpose"]}
          rows={[
            [<Code key="m">POST</Code>, <Code key="p">/v1/chat/completions</Code>, "Generate a chat completion."],
            [<Code key="m">GET</Code>, <Code key="p">/v1/models</Code>, "List models your configured keys can serve."],
            [<Code key="m">GET</Code>, <Code key="p">/v1/models/{"{model}"}</Code>, "Retrieve one model."],
          ]}
        />
        <P>
          Base URL: <Code>{baseUrl}/v1</Code>
        </P>
      </Section>

      <Section title="Request body">
        <Table
          head={["Field", "Type", "Notes"]}
          rows={[
            [<Code key="f">model</Code>, "string", <>Required. See <Link key="l" href="/docs/models" className="text-heat-ink hover:underline">Models</Link>.</>],
            [<Code key="f">messages</Code>, "array", <>Required. <Code key="c">system</Code>, <Code key="c2">developer</Code>, <Code key="c3">user</Code> and <Code key="c4">assistant</Code> roles, with string or text-part content.</>],
            [<Code key="f">temperature</Code>, "number", "0 to 2."],
            [<Code key="f">top_p</Code>, "number", "0 to 1."],
            [<Code key="f">max_completion_tokens</Code>, "integer", <>Also accepts the older <Code key="c">max_tokens</Code>.</>],
            [<Code key="f">stop</Code>, "string | string[]", "Up to 16 stop sequences."],
            [<Code key="f">n</Code>, "integer", "1 to 8 candidates."],
            [<Code key="f">presence_penalty</Code>, "number", "−2 to 2."],
            [<Code key="f">frequency_penalty</Code>, "number", "−2 to 2."],
            [<Code key="f">seed</Code>, "integer", "Best-effort determinism, where the provider supports it."],
          ]}
        />
        <P>
          <Code>stream</Code> and <Code>stream_options</Code> are supported; see{" "}
          <Link href="/docs/streaming" className="text-heat-ink hover:underline">
            Streaming
          </Link>
          . Unknown fields are ignored, so newer SDK options will not break a request. Fields the gateway understands but cannot yet honour are rejected with a{" "}
          <Code>400 unsupported_parameter</Code> naming the field, rather than being silently dropped, because a wrong answer is worse than a clear error. Today
          that list is <Code>tools</Code>, <Code>response_format</Code>, <Code>reasoning_effort</Code>, and image or audio content parts.
        </P>
      </Section>

      <Section title="Response">
        <P>The response is the standard Chat Completions object, so existing parsing code works unchanged.</P>
        <CodeBlock
          language="json"
          code={`{
  "id": "chatcmpl-8f2c…",
  "object": "chat.completion",
  "created": 1789888375,
  "model": "gemini-3.8-flash",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello!", "refusal": null },
      "finish_reason": "stop",
      "logprobs": null
    }
  ],
  "usage": {
    "prompt_tokens": 9,
    "completion_tokens": 17,
    "total_tokens": 26,
    "completion_tokens_details": { "reasoning_tokens": 0 }
  }
}`}
        />
        <P>
          Token counts come from the provider. For models that think before answering, reasoning tokens are counted in{" "}
          <Code>completion_tokens</Code> and broken out under <Code>completion_tokens_details.reasoning_tokens</Code>.
        </P>
      </Section>

      <Section title="Response headers">
        <Ul>
          <Li>
            <Code>x-request-id</Code>: identifies the request in your dashboard; quote it when reporting a problem.
          </Li>
          <Li>
            <Code>x-juggle-attempts</Code>: how many provider keys were tried. Greater than 1 means failover did its job.
          </Li>
          <Li>
            <Code>x-ratelimit-limit-requests</Code>, <Code>x-ratelimit-remaining-requests</Code>, <Code>x-ratelimit-reset-requests</Code>: your gateway
            key&rsquo;s per-minute budget.
          </Li>
          <Li>
            <Code>retry-after</Code>: on 429 and 503, how long to wait.
          </Li>
        </Ul>
      </Section>

      <Section title="Which key served the request?">
        <P>
          Deliberately not exposed to the client: your application should not need to know, and the answer is not stable. The dashboard shows the key hint for
          every request under{" "}
          <Link href="/dashboard/requests" className="text-heat-ink hover:underline">
            Requests
          </Link>
          .
        </P>
      </Section>

      <Note>
        Prefer provider-prefixed model names (<Code>gemini/gemini-3.8-flash</Code>) if you plan to use several providers later, so they stay unambiguous.
      </Note>
    </DocsPage>
  );
}
