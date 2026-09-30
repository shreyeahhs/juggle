/**
 * A local stand-in for the Gemini API, for development without real keys:
 *
 *   pnpm mock:gemini                     # listens on http://localhost:4010
 *   GEMINI_BASE_URL=http://localhost:4010 pnpm dev
 *
 * The key you paste in the dashboard decides the behaviour, so you can try the
 * routing engine end to end:
 *
 *   mock-key-ok-1        always succeeds
 *   mock-key-429-1       always rate limited (RetryInfo: 45s)
 *   mock-key-429day-1    daily quota exhausted (cools down until midnight PT)
 *   mock-key-invalid-1   rejected as an invalid key
 *   mock-key-403-1       permission denied
 *   mock-key-500-1       upstream error
 *   mock-key-slow-1      responds after 30 s (exercises timeouts)
 *   mock-key-flaky-1     fails roughly half the time
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_GEMINI_PORT ?? 4010);
const MODELS = ["gemini-3.8-flash", "gemini-pro-latest", "gemini-flash-lite-latest"];

const json = (status: number, body: unknown) => ({ status, body: JSON.stringify(body) });
const googleError = (code: number, status: string, message: string, details: unknown[] = []) => json(code, { error: { code, status, message, details } });

function behaviourFor(key: string, model: string): { status: number; body: string; delayMs?: number } {
  if (key.includes("invalid")) {
    return googleError(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", [
      { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" },
    ]);
  }
  if (key.includes("403")) return googleError(403, "PERMISSION_DENIED", "Permission denied on resource project 123456789.");
  if (key.includes("429day")) {
    return googleError(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota.", [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaDimensions: { model }, quotaValue: "50" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" },
    ]);
  }
  if (key.includes("429")) {
    return googleError(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota.", [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quotaDimensions: { model }, quotaValue: "10" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "45s" },
    ]);
  }
  if (key.includes("500")) return googleError(500, "INTERNAL", "An internal error has occurred.");
  if (key.includes("503")) return googleError(503, "UNAVAILABLE", "The model is overloaded. Please try again later.");
  if (key.includes("flaky") && Math.random() < 0.5) return googleError(503, "UNAVAILABLE", "The model is overloaded. Please try again later.");

  const result = json(200, {
    candidates: [
      {
        index: 0,
        content: { role: "model", parts: [{ text: `Hello from the mock Gemini server (model ${model}, key …${key.slice(-6)}).` }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 17, totalTokenCount: 26 },
    modelVersion: model,
    responseId: `mock-${Date.now().toString(36)}`,
  });
  return key.includes("slow") ? { ...result, delayMs: 30_000 } : result;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  const key = (request.headers["x-goog-api-key"] as string | undefined) ?? "";
  const send = (status: number, body: string, delayMs = 0) => {
    setTimeout(() => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body);
      console.log(`${status} ${request.method} ${url.pathname} key=…${key.slice(-8) || "none"}`);
    }, delayMs);
  };

  if (!key) {
    const error = googleError(401, "UNAUTHENTICATED", "Method doesn't allow unregistered callers.");
    return send(error.status, error.body);
  }
  if (url.pathname === "/v1beta/models" && request.method === "GET") {
    if (key.includes("invalid")) {
      const error = googleError(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", [
        { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" },
      ]);
      return send(error.status, error.body);
    }
    return send(
      200,
      JSON.stringify({
        models: MODELS.map((id) => ({
          name: `models/${id}`,
          displayName: id,
          supportedGenerationMethods: ["generateContent", "countTokens"],
          inputTokenLimit: 1_048_576,
          outputTokenLimit: 65_536,
        })),
      }),
    );
  }

  const match = /^\/v1beta\/models\/([^:]+):(streamGenerateContent|generateContent)$/.exec(url.pathname);
  if (match && request.method === "POST") {
    const model = decodeURIComponent(match[1]!);
    const streaming = match[2] === "streamGenerateContent";
    request.resume();
    request.on("end", () => {
      const behaviour = behaviourFor(key, model);
      if (!streaming) return send(behaviour.status, behaviour.body, behaviour.delayMs);

      // Streaming: non-200 behaviours still fail before the stream starts, so
      // the gateway can classify them and rotate keys as usual.
      if (behaviour.status !== 200) return send(behaviour.status, behaviour.body, behaviour.delayMs);

      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const words = `Streaming from the mock Gemini server (model ${model}, key …${key.slice(-6)}).`.split(" ");
      let index = 0;
      const timer = setInterval(() => {
        const last = index === words.length - 1;
        const chunk = {
          candidates: [
            {
              index: 0,
              content: { role: "model", parts: [{ text: (index === 0 ? "" : " ") + words[index] }] },
              ...(last ? { finishReason: "STOP" } : {}),
            },
          ],
          ...(last ? { usageMetadata: { promptTokenCount: 9, candidatesTokenCount: words.length, totalTokenCount: 9 + words.length } } : {}),
          modelVersion: model,
          responseId: `mock-stream-${Date.now().toString(36)}`,
        };
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
        index += 1;
        if (index >= words.length) {
          clearInterval(timer);
          response.end();
          console.log(`200 STREAM ${url.pathname} key=…${key.slice(-8)}`);
        }
      }, 60);
      request.on("close", () => clearInterval(timer));
    });
    return;
  }

  const error = googleError(404, "NOT_FOUND", `${url.pathname} is not supported by the mock server.`);
  return send(error.status, error.body);
});

server.listen(PORT, () => {
  console.log(`Mock Gemini API listening on http://localhost:${PORT}`);
  console.log(`Point Juggle at it with:  GEMINI_BASE_URL=http://localhost:${PORT}`);
});
