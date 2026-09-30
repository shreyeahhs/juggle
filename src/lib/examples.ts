import type { CodeSample } from "@/components/code-block";

const PLACEHOLDER = "gw_live_your_key_here";

/** Copy-paste integration examples, rendered with the deployment's own URL. */
export function quickstartSamples(baseUrl: string, model = "gemini-3.8-flash", apiKey = PLACEHOLDER): CodeSample[] {
  return [
    {
      label: "cURL",
      language: "bash",
      code: `curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [
      { "role": "user", "content": "Hello" }
    ]
  }'`,
    },
    {
      label: "OpenAI SDK (JS)",
      language: "javascript",
      code: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.JUGGLE_API_KEY, // ${apiKey}
  baseURL: "${baseUrl}/v1",
});

const completion = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(completion.choices[0].message.content);`,
    },
    {
      label: "OpenAI SDK (Python)",
      language: "python",
      code: `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["JUGGLE_API_KEY"],  # ${apiKey}
    base_url="${baseUrl}/v1",
)

completion = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello"}],
)

print(completion.choices[0].message.content)`,
    },
    {
      label: "fetch",
      language: "javascript",
      code: `const response = await fetch("${baseUrl}/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.JUGGLE_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "${model}",
    messages: [{ role: "user", content: "Hello" }],
  }),
});

const data = await response.json();
console.log(data.choices[0].message.content);`,
    },
  ];
}
