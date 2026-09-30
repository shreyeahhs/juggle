import type { Metadata } from "next";
import Link from "next/link";
import { CodeTabs } from "@/components/code-block";
import { Code, DocsPage, Li, Note, P, Section, Ul } from "@/components/docs/prose";
import { getAppUrl } from "@/server/app-url";

export const metadata: Metadata = { title: "Streaming" };

export default async function StreamingDocsPage() {
  const baseUrl = await getAppUrl();

  return (
    <DocsPage
      title="Streaming"
      intro="Set stream: true to receive the response as Server-Sent Events. Chunks are forwarded as they arrive from the provider, never buffered to completion first."
    >
      <Section title="Making a streaming request">
        <CodeTabs
          samples={[
            {
              label: "OpenAI SDK (JS)",
              language: "javascript",
              code: `const stream = await client.chat.completions.create({
  model: "gemini-3.8-flash",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`,
            },
            {
              label: "OpenAI SDK (Python)",
              language: "python",
              code: `stream = client.chat.completions.create(
    model="gemini-3.8-flash",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`,
            },
            {
              label: "cURL",
              language: "bash",
              code: `curl -N ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer gw_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-3.8-flash",
    "messages": [{ "role": "user", "content": "Hello" }],
    "stream": true
  }'`,
            },
          ]}
        />
        <P>
          The wire format is the OpenAI one: a sequence of <Code>chat.completion.chunk</Code> events, then <Code>data: [DONE]</Code>. The first delta carries{" "}
          <Code>role: &quot;assistant&quot;</Code>, and the final content chunk carries <Code>finish_reason</Code>.
        </P>
      </Section>

      <Section title="Token usage">
        <P>
          Send <Code>stream_options: {"{ include_usage: true }"}</Code> to receive one extra chunk at the end with an empty <Code>choices</Code> array and a{" "}
          <Code>usage</Code> object. Usage is recorded in your dashboard either way.
        </P>
      </Section>

      <Section title="How failover interacts with streaming">
        <P>Retrying is only safe before the first byte reaches your client, and that boundary shapes the behaviour:</P>
        <Ul>
          <Li>
            The gateway waits for the provider&rsquo;s response headers before sending anything. A rate limit or rejected key at that point is invisible to you:
            keys rotate and the request is retried as usual, then the stream begins.
          </Li>
          <Li>
            Once the first chunk has been forwarded, the request is committed to that key. A failure after that point is <strong className="text-ink">not</strong>{" "}
            retried, because the tokens you already received cannot be un-sent.
          </Li>
          <Li>
            A mid-stream failure arrives as a final SSE event carrying an <Code>error</Code> object, followed by <Code>[DONE]</Code>. The HTTP status was already
            200, so check for that event rather than relying on the status code. Content received before the failure is preserved.
          </Li>
          <Li>If the provider goes quiet for longer than the idle timeout, the stream is closed with a timeout error event.</Li>
        </Ul>
      </Section>

      <Note tone="warning">
        Reverse proxies love to buffer SSE. The gateway sets <Code>x-accel-buffering: no</Code> and disables transform caching, but if you put your own nginx in
        front, turn off <Code>proxy_buffering</Code> for this route or responses will arrive all at once.
      </Note>

      <Note>
        Cancelling the request (closing the connection or aborting the SDK call) propagates upstream: the provider call is cancelled too, and the request is
        recorded as cancelled rather than failed. See{" "}
        <Link href="/docs/rate-limits" className="text-heat-ink hover:underline">
          Rate limits &amp; failover
        </Link>{" "}
        for the non-streaming behaviour.
      </Note>
    </DocsPage>
  );
}
