import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
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
// Zod schemas for SSE event validation
// ---------------------------------------------------------------------------

const SseEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("content_block_delta"),
    delta: z.object({
      type: z.literal("text_delta"),
      text: z.string(),
    }),
  }),
  z.object({ type: z.literal("message_stop") }),
  z.object({ type: z.literal("message_start") }),
  z.object({ type: z.literal("content_block_start") }),
  z.object({ type: z.literal("content_block_stop") }),
  z.object({ type: z.literal("message_delta") }),
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
// SSE stream parser
// ---------------------------------------------------------------------------

async function* parseSSEStream(
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
        if (event.type === "content_block_delta") {
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
// Main export
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
      err instanceof Error ? err.message : "Network error — check your connection";
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
  yield* parseSSEStream(reader);
}
