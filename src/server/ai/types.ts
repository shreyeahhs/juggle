/** OpenAI-compatible response shapes produced by every provider adapter. */

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter";

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface ResponseToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  extra_content?: Record<string, unknown>;
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      refusal: string | null;
      tool_calls?: ResponseToolCall[];
    };
    finish_reason: FinishReason;
    logprobs: null;
  }>;
  usage?: Usage;
}

export interface ChunkToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
  extra_content?: Record<string, unknown>;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string | null;
      refusal?: string | null;
      tool_calls?: ChunkToolCallDelta[];
    };
    finish_reason: FinishReason | null;
    logprobs: null;
  }>;
  usage?: Usage | null;
}

export interface ModelInfo {
  /** ID accepted in `model` (without provider prefix). */
  id: string;
  provider: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}
