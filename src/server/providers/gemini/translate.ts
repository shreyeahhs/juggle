import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatRequest } from "@/server/ai/chat-schema";
import type { ChatCompletion, ChatCompletionChunk, FinishReason, Usage } from "@/server/ai/types";
import type { GeminiContent, GeminiGenerationConfig, GeminiPart, GeminiRequestBody, GeminiResponse, GeminiUsageMetadata } from "./api-types";

/**
 * OpenAI Chat Completions ⇄ Gemini generateContent translation.
 */

export class TranslationError extends Error {
  override name = "TranslationError";
  constructor(
    message: string,
    readonly param: string | undefined,
    readonly code: "unsupported_parameter" | "invalid_request" = "unsupported_parameter",
  ) {
    super(message);
  }
}

/* ─── Request ─────────────────────────────────────────────────────────────── */

function textFromContent(content: string | Array<{ type: string; text?: string }> | null | undefined, param: string): string[] {
  if (content == null) return [];
  if (typeof content === "string") return content.length ? [content] : [];
  return content.map((part, index) => {
    if (part.type !== "text" || typeof part.text !== "string") {
      throw new TranslationError(`Content part type "${part.type}" is not supported here yet.`, `${param}[${index}]`);
    }
    return part.text;
  });
}

function appendContent(contents: GeminiContent[], role: "user" | "model", parts: GeminiPart[]): void {
  if (!parts.length) return;
  const previous = contents.at(-1);
  // Gemini expects alternating turns; merging consecutive same-role messages keeps any OpenAI history valid.
  if (previous?.role === role) previous.parts.push(...parts);
  else contents.push({ role, parts });
}

function translateMessage(message: ChatMessage, index: number, contents: GeminiContent[], system: string[]): void {
  const param = `messages[${index}]`;
  switch (message.role) {
    case "system":
    case "developer":
      system.push(...textFromContent(message.content, `${param}.content`));
      return;
    case "user":
      appendContent(
        contents,
        "user",
        textFromContent(message.content, `${param}.content`).map((text) => ({ text })),
      );
      return;
    case "assistant":
      if (message.tool_calls?.length) {
        throw new TranslationError("Tool calls are not supported yet.", `${param}.tool_calls`);
      }
      appendContent(
        contents,
        "model",
        textFromContent(message.content, `${param}.content`).map((text) => ({ text })),
      );
      return;
    case "tool":
      throw new TranslationError("Tool messages are not supported yet.", `${param}.role`);
  }
}

function buildGenerationConfig(request: ChatRequest): GeminiGenerationConfig | undefined {
  const config: GeminiGenerationConfig = {};
  if (request.temperature !== undefined) config.temperature = request.temperature;
  if (request.top_p !== undefined) config.topP = request.top_p;
  const maxTokens = request.max_completion_tokens ?? request.max_tokens;
  if (maxTokens !== undefined) config.maxOutputTokens = maxTokens;
  if (request.stop != null) {
    const stops = typeof request.stop === "string" ? [request.stop] : request.stop;
    if (stops.length) config.stopSequences = stops;
  }
  if (request.n !== undefined && request.n !== 1) config.candidateCount = request.n;
  if (request.presence_penalty !== undefined) config.presencePenalty = request.presence_penalty;
  if (request.frequency_penalty !== undefined) config.frequencyPenalty = request.frequency_penalty;
  if (request.seed !== undefined) config.seed = request.seed;
  return Object.keys(config).length ? config : undefined;
}

function rejectUnsupported(request: ChatRequest): void {
  if (request.tools?.length) throw new TranslationError("Tools / function calling are not supported yet.", "tools");
  if (request.tool_choice !== undefined && request.tool_choice !== "none" && request.tool_choice !== "auto") {
    throw new TranslationError("tool_choice requires tools, which are not supported yet.", "tool_choice");
  }
  if (request.response_format && request.response_format.type !== "text") {
    throw new TranslationError("response_format is not supported yet.", "response_format");
  }
  if (request.reasoning_effort != null) throw new TranslationError("reasoning_effort is not supported yet.", "reasoning_effort");
  if (request.logprobs) throw new TranslationError("logprobs is not supported for Gemini.", "logprobs");
}

export function toGeminiRequest(request: ChatRequest): GeminiRequestBody {
  rejectUnsupported(request);

  const contents: GeminiContent[] = [];
  const system: string[] = [];
  request.messages.forEach((message, index) => translateMessage(message, index, contents, system));

  if (!contents.length) {
    throw new TranslationError("messages must include at least one user or assistant message.", "messages", "invalid_request");
  }

  const body: GeminiRequestBody = { contents };
  if (system.length) body.systemInstruction = { parts: [{ text: system.join("\n\n") }] };
  const generationConfig = buildGenerationConfig(request);
  if (generationConfig) body.generationConfig = generationConfig;
  return body;
}

/* ─── Response ────────────────────────────────────────────────────────────── */

const CONTENT_FILTER_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
  "LANGUAGE",
]);

export function mapFinishReason(reason: string | undefined, hasToolCalls: boolean): FinishReason | null {
  if (!reason || reason === "FINISH_REASON_UNSPECIFIED") return null;
  if (hasToolCalls) return "tool_calls";
  if (reason === "MAX_TOKENS") return "length";
  if (CONTENT_FILTER_REASONS.has(reason)) return "content_filter";
  return "stop";
}

export function mapUsage(usage: GeminiUsageMetadata | undefined): Usage | undefined {
  if (!usage) return undefined;
  const prompt = (usage.promptTokenCount ?? 0) + (usage.toolUsePromptTokenCount ?? 0);
  const reasoning = usage.thoughtsTokenCount ?? 0;
  const completion = (usage.candidatesTokenCount ?? 0) + reasoning;
  const result: Usage = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage.totalTokenCount ?? prompt + completion,
  };
  if (usage.cachedContentTokenCount) result.prompt_tokens_details = { cached_tokens: usage.cachedContentTokenCount };
  if (reasoning) result.completion_tokens_details = { reasoning_tokens: reasoning };
  return result;
}

/** Visible text of a candidate. Thought summaries are internal and never included. */
export function visibleText(parts: GeminiPart[] | undefined): string {
  return (parts ?? [])
    .filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("");
}

export function completionId(responseId: string | undefined): string {
  return `chatcmpl-${responseId ?? randomUUID().replaceAll("-", "")}`;
}

/* ─── Streaming ───────────────────────────────────────────────────────────── */

/**
 * Converts a sequence of Gemini stream chunks into OpenAI `chat.completion.chunk`
 * objects, holding the little state the OpenAI protocol requires: the role is
 * announced once in the first delta, and usage (when asked for) arrives in a
 * final chunk with no choices.
 */
export function createChunkTranslator(requestedModel: string, options: { includeUsage: boolean; now?: () => number } = { includeUsage: false }) {
  const now = options.now ?? Date.now;
  const created = Math.floor(now() / 1000);
  let id: string | undefined;
  let roleSent = false;
  let usage: Usage | undefined;

  const base = (choices: ChatCompletionChunk["choices"]): ChatCompletionChunk => ({
    id: (id ??= completionId(undefined)),
    object: "chat.completion.chunk",
    created,
    model: requestedModel,
    choices,
  });

  return {
    /** Chunks to emit for one upstream chunk (usually one, sometimes none). */
    push(response: GeminiResponse): ChatCompletionChunk[] {
      id ??= completionId(response.responseId);
      const mapped = mapUsage(response.usageMetadata);
      if (mapped) usage = mapped;

      const out: ChatCompletionChunk[] = [];
      const candidates = response.candidates ?? [];

      if (!candidates.length && response.promptFeedback?.blockReason) {
        out.push(
          base([
            {
              index: 0,
              delta: { role: "assistant", refusal: `Prompt blocked by provider (${response.promptFeedback.blockReason}).` },
              finish_reason: "content_filter",
              logprobs: null,
            },
          ]),
        );
        roleSent = true;
        return out;
      }

      for (const [position, candidate] of candidates.entries()) {
        const index = candidate.index ?? position;
        const text = visibleText(candidate.content?.parts);
        const finish = mapFinishReason(candidate.finishReason, false);
        const delta: ChatCompletionChunk["choices"][number]["delta"] = {};
        if (!roleSent) {
          delta.role = "assistant";
          roleSent = true;
        }
        if (text) delta.content = text;
        // Skip empty deltas unless they carry the finish reason.
        if (!Object.keys(delta).length && finish === null) continue;
        out.push(base([{ index, delta, finish_reason: finish, logprobs: null }]));
      }
      return out;
    },

    /** Final usage-only chunk, when the caller asked for usage. */
    finish(): ChatCompletionChunk[] {
      if (!options.includeUsage) return [];
      return [{ ...base([]), usage: usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }];
    },

    get usage(): Usage | undefined {
      return usage;
    },
  };
}

export function fromGeminiResponse(response: GeminiResponse, requestedModel: string, now = Date.now()): ChatCompletion {
  const created = Math.floor(now / 1000);
  const candidates = response.candidates ?? [];

  const choices: ChatCompletion["choices"] = candidates.length
    ? candidates.map((candidate, index) => {
        const text = visibleText(candidate.content?.parts);
        const finish = mapFinishReason(candidate.finishReason, false) ?? "stop";
        return {
          index: candidate.index ?? index,
          message: { role: "assistant", content: text.length ? text : null, refusal: null },
          finish_reason: finish,
          logprobs: null,
        };
      })
    : [
        {
          // The prompt itself was blocked: Gemini returns no candidates.
          index: 0,
          message: {
            role: "assistant",
            content: null,
            refusal: response.promptFeedback?.blockReason ? `Prompt blocked by provider (${response.promptFeedback.blockReason}).` : null,
          },
          finish_reason: "content_filter",
          logprobs: null,
        },
      ];

  const completion: ChatCompletion = {
    id: completionId(response.responseId),
    object: "chat.completion",
    created,
    model: requestedModel,
    choices,
  };
  const usage = mapUsage(response.usageMetadata);
  if (usage) completion.usage = usage;
  return completion;
}
