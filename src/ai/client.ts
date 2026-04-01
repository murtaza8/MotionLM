import { z } from "zod";

// ---------------------------------------------------------------------------
// Legacy types (kept for existing UI — CommandPalette, GenerateChat)
// ---------------------------------------------------------------------------

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "message_stop" }
  | { type: "error"; error: string };

export interface EditResponse {
  file: string;
  code: string;
  explanation: string;
  seekToFrame?: number;
}

// ---------------------------------------------------------------------------
// Agent request types
// ---------------------------------------------------------------------------

export interface CacheControl {
  type: "ephemeral";
}

// Minimal content block types for HTTP serialization.
// Structurally compatible with ContentBlock from @/agent/types so callers
// can pass AgentMessage[] without casting.
export type AgentContentBlock =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      cache_control?: CacheControl;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: Array<
        | { type: "text"; text: string }
        | {
            type: "image";
            source: { type: "base64"; media_type: "image/png"; data: string };
          }
      >;
      is_error?: boolean;
    }
  | {
      type: "image";
      source: { type: "base64"; media_type: "image/png"; data: string };
      cache_control?: CacheControl;
    };

export interface AgentRequestMessage {
  role: "user" | "assistant";
  content: AgentContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: CacheControl;
}

// System prompt block (text only — API constraint)
export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

// ---------------------------------------------------------------------------
// Agent stream events yielded by sendAgentRequest
// ---------------------------------------------------------------------------

export type AgentStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; index: number; id: string; name: string }
  | { type: "tool_input_delta"; index: number; partial_json: string }
  | { type: "tool_use_end"; index: number }
  | { type: "message_stop"; stop_reason: string | null }
  | {
      type: "usage";
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
    }
  | { type: "error"; error: string };

// ---------------------------------------------------------------------------
// Zod schemas for SSE event validation
// ---------------------------------------------------------------------------

const SseEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("content_block_delta"),
    index: z.number(),
    delta: z.discriminatedUnion("type", [
      z.object({ type: z.literal("text_delta"), text: z.string() }),
      z.object({
        type: z.literal("input_json_delta"),
        partial_json: z.string(),
      }),
    ]),
  }),
  z.object({
    type: z.literal("content_block_start"),
    index: z.number(),
    content_block: z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("tool_use"),
        id: z.string(),
        name: z.string(),
      }),
    ]),
  }),
  z.object({ type: z.literal("content_block_stop"), index: z.number() }),
  z.object({
    type: z.literal("message_start"),
    message: z.object({
      usage: z
        .object({
          input_tokens: z.number(),
          cache_read_input_tokens: z.number().optional(),
          cache_creation_input_tokens: z.number().optional(),
        })
        .optional(),
    }),
  }),
  z.object({
    type: z.literal("message_delta"),
    delta: z.object({ stop_reason: z.string().nullable() }),
    usage: z.object({ output_tokens: z.number() }).optional(),
  }),
  z.object({ type: z.literal("message_stop") }),
  z.object({ type: z.literal("ping") }),
  z.object({
    type: z.literal("error"),
    error: z.object({ message: z.string() }),
  }),
]);

const EditResponseSchema = z.object({
  file: z.string(),
  code: z.string(),
  explanation: z.string(),
  seekToFrame: z.number().optional(),
});

export { EditResponseSchema };

// ---------------------------------------------------------------------------
// HTTP error mapping
// ---------------------------------------------------------------------------

function mapHttpError(status: number): string {
  switch (status) {
    case 401:
      return "Invalid API key";
    case 429:
      return "Rate limit reached — wait a moment and try again";
    case 500:
      return "Claude API error — try again";
    default:
      return `API request failed (${status})`;
  }
}

// ---------------------------------------------------------------------------
// API key validation
// ---------------------------------------------------------------------------

function isValidApiKeyFormat(apiKey: string): boolean {
  return apiKey.startsWith("sk-ant-");
}

// ---------------------------------------------------------------------------
// Legacy SSE stream parser (text-only, for sendEditRequest)
// ---------------------------------------------------------------------------

async function* parseLegacySSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<StreamChunk> {
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "[DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        const jsonStr = trimmed.slice("data: ".length);
        if (jsonStr === "[DONE]") continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const result = SseEventSchema.safeParse(parsed);
        if (!result.success) continue;

        const event = result.data;
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text_delta", text: event.delta.text };
        } else if (event.type === "message_stop") {
          yield { type: "message_stop" };
          return;
        } else if (event.type === "error") {
          yield { type: "error", error: event.error.message };
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Agent SSE stream parser — yields AgentStreamEvent
// ---------------------------------------------------------------------------

async function* parseAgentSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<AgentStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  let stopReason: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const jsonStr = trimmed.slice("data: ".length);
        if (jsonStr === "[DONE]") break outer;

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const result = SseEventSchema.safeParse(parsed);
        if (!result.success) continue;

        const event = result.data;

        if (event.type === "message_start" && event.message.usage) {
          inputTokens = event.message.usage.input_tokens;
          cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0;
          cacheCreationTokens =
            event.message.usage.cache_creation_input_tokens ?? 0;
        } else if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            yield {
              type: "tool_use_start",
              index: event.index,
              id: event.content_block.id,
              name: event.content_block.name,
            };
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            yield { type: "text_delta", text: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            yield {
              type: "tool_input_delta",
              index: event.index,
              partial_json: event.delta.partial_json,
            };
          }
        } else if (event.type === "content_block_stop") {
          yield { type: "tool_use_end", index: event.index };
        } else if (event.type === "message_delta") {
          stopReason = event.delta.stop_reason;
          outputTokens = event.usage?.output_tokens ?? 0;
        } else if (event.type === "message_stop") {
          break outer;
        } else if (event.type === "error") {
          yield { type: "error", error: event.error.message };
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield {
    type: "usage",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheCreationTokens,
  };
  yield { type: "message_stop", stop_reason: stopReason };
}

// ---------------------------------------------------------------------------
// sendEditRequest — legacy, for existing CommandPalette / GenerateChat UI
// ---------------------------------------------------------------------------

export async function* sendEditRequest(
  messages: Message[],
  apiKey: string,
  model: string,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  if (!isValidApiKeyFormat(apiKey)) {
    yield { type: "error", error: "Invalid API key" };
    return;
  }

  let response: Response;
  try {
    response = await fetch("/api/claude", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        stream: true,
        messages,
      }),
      signal,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Network error — check your connection";
    yield { type: "error", error: message };
    return;
  }

  if (!response.ok) {
    yield { type: "error", error: mapHttpError(response.status) };
    return;
  }

  if (!response.body) {
    yield { type: "error", error: "No response body received from API" };
    return;
  }

  const reader = response.body.getReader();
  yield* parseLegacySSEStream(reader);
}

// ---------------------------------------------------------------------------
// sendAgentRequest — agent loop client with tool_use + cache_control support
// ---------------------------------------------------------------------------

export async function* sendAgentRequest(
  messages: AgentRequestMessage[],
  tools: ToolDefinition[],
  apiKey: string,
  model: string,
  system?: SystemBlock[],
  signal?: AbortSignal
): AsyncGenerator<AgentStreamEvent> {
  if (!isValidApiKeyFormat(apiKey)) {
    yield { type: "error", error: "Invalid API key" };
    return;
  }

  let response: Response;
  try {
    response = await fetch("/api/claude", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        stream: true,
        ...(system && system.length > 0 ? { system } : {}),
        tools,
        messages,
      }),
      signal,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Network error — check your connection";
    yield { type: "error", error: message };
    return;
  }

  if (!response.ok) {
    let errorMessage = mapHttpError(response.status);
    try {
      const body = await response.json() as { error?: { message?: string; type?: string } };
      // Log full error body to console so it's visible in devtools
      console.error("[Claude API] Error response:", response.status, body);
      if (body?.error?.message) {
        errorMessage = `${response.status}: ${body.error.message}`;
      }
    } catch {
      console.error("[Claude API] Error status:", response.status);
    }
    yield { type: "error", error: errorMessage };
    return;
  }

  if (!response.body) {
    yield { type: "error", error: "No response body received from API" };
    return;
  }

  const reader = response.body.getReader();
  yield* parseAgentSSEStream(reader);
}
