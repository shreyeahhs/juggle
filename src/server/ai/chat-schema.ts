import { z } from "zod";

/**
 * OpenAI Chat Completions request schema: the gateway's public contract and
 * the normalised format every provider adapter consumes.
 *
 * Objects are "loose": unknown fields are ignored rather than rejected, because
 * SDKs add new optional fields constantly. Fields we know about but can't honour
 * are rejected explicitly by the adapters (see `UnsupportedFeatureError`).
 */

const nullishNumber = (schema: z.ZodNumber) => schema.nullish().transform((value) => value ?? undefined);

export const textPartSchema = z.looseObject({ type: z.literal("text"), text: z.string() });
export const imagePartSchema = z.looseObject({
  type: z.literal("image_url"),
  image_url: z.looseObject({
    url: z.string().min(1),
    detail: z.enum(["auto", "low", "high"]).optional(),
  }),
});
export const audioPartSchema = z.looseObject({
  type: z.literal("input_audio"),
  input_audio: z.looseObject({ data: z.string().min(1), format: z.string().min(1) }),
});
export const filePartSchema = z.looseObject({
  type: z.literal("file"),
  file: z.looseObject({
    file_data: z.string().optional(),
    file_id: z.string().optional(),
    filename: z.string().optional(),
  }),
});
export const refusalPartSchema = z.looseObject({ type: z.literal("refusal"), refusal: z.string() });

const userContentPart = z.discriminatedUnion("type", [textPartSchema, imagePartSchema, audioPartSchema, filePartSchema]);

export const toolCallSchema = z.looseObject({
  id: z.string().min(1).max(4096),
  type: z.literal("function"),
  function: z.looseObject({ name: z.string().min(1).max(256), arguments: z.string() }),
  /** Provider-specific round-trip data (e.g. Gemini thought signatures). */
  extra_content: z.record(z.string(), z.unknown()).optional(),
});

const systemMessage = z.looseObject({
  role: z.literal("system"),
  content: z.union([z.string(), z.array(textPartSchema)]),
  name: z.string().optional(),
});
const developerMessage = z.looseObject({
  role: z.literal("developer"),
  content: z.union([z.string(), z.array(textPartSchema)]),
  name: z.string().optional(),
});
const userMessage = z.looseObject({
  role: z.literal("user"),
  content: z.union([z.string(), z.array(userContentPart)]),
  name: z.string().optional(),
});
const assistantMessage = z.looseObject({
  role: z.literal("assistant"),
  content: z.union([z.string(), z.array(z.discriminatedUnion("type", [textPartSchema, refusalPartSchema]))]).nullish(),
  refusal: z.string().nullish(),
  tool_calls: z.array(toolCallSchema).optional(),
  name: z.string().optional(),
});
const toolMessage = z.looseObject({
  role: z.literal("tool"),
  content: z.union([z.string(), z.array(textPartSchema)]),
  tool_call_id: z.string().min(1).max(4096),
});

export const chatMessageSchema = z.discriminatedUnion("role", [systemMessage, developerMessage, userMessage, assistantMessage, toolMessage]);

export const functionToolSchema = z.looseObject({
  type: z.literal("function"),
  function: z.looseObject({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/, "Function names must be 1 to 128 characters: letters, digits, _ . : -"),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().nullish(),
  }),
});

export const toolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.looseObject({ type: z.literal("function"), function: z.looseObject({ name: z.string() }) }),
]);

export const responseFormatSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("text") }),
  z.looseObject({ type: z.literal("json_object") }),
  z.looseObject({
    type: z.literal("json_schema"),
    json_schema: z.looseObject({
      name: z.string(),
      description: z.string().optional(),
      schema: z.record(z.string(), z.unknown()).optional(),
      strict: z.boolean().nullish(),
    }),
  }),
]);

export const chatRequestSchema = z.looseObject({
  model: z.string().trim().min(1, "model is required").max(200),
  messages: z.array(chatMessageSchema).min(1, "messages must contain at least one message").max(10_000),
  stream: z.boolean().nullish().transform((value) => value ?? false),
  stream_options: z.looseObject({ include_usage: z.boolean().optional() }).nullish(),

  temperature: nullishNumber(z.number().min(0).max(2)),
  top_p: nullishNumber(z.number().min(0).max(1)),
  max_tokens: nullishNumber(z.number().int().positive()),
  max_completion_tokens: nullishNumber(z.number().int().positive()),
  n: nullishNumber(z.number().int().min(1).max(8)),
  stop: z.union([z.string(), z.array(z.string()).max(16)]).nullish(),
  presence_penalty: nullishNumber(z.number().min(-2).max(2)),
  frequency_penalty: nullishNumber(z.number().min(-2).max(2)),
  seed: nullishNumber(z.number().int()),

  tools: z.array(functionToolSchema).max(256).optional(),
  tool_choice: toolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().nullish(),
  response_format: responseFormatSchema.optional(),
  reasoning_effort: z.enum(["none", "minimal", "low", "medium", "high"]).nullish(),

  logprobs: z.boolean().nullish(),
  top_logprobs: z.number().int().nullish(),
  user: z.string().max(512).optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type FunctionTool = z.infer<typeof functionToolSchema>;
export type UserContentPart = z.infer<typeof userContentPart>;
