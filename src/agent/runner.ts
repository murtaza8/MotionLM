import { sendAgentRequest } from "@/ai/client";
import { AgentState } from "./types";

import type { AgentAction, AgentMessage, TokenUsage, ToolResultContentBlock } from "./types";
import type { AgentTool } from "./tools/types";
import type { AgentRequestMessage, SystemBlock, ToolDefinition } from "@/ai/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 25;

// ---------------------------------------------------------------------------
// validateMessages — ensure tool_use/tool_result pairing before each API call
// ---------------------------------------------------------------------------

/**
 * Validates that every assistant message with tool_use blocks is immediately
 * followed by a user message containing matching tool_result blocks.
 *
 * If a violation is found, truncates the messages array to the last valid
 * point and logs a warning. Returns the (possibly truncated) array.
 */
function validateMessages(
  messages: AgentRequestMessage[]
): AgentRequestMessage[] {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    const toolUseIds = msg.content
      .filter((b) => b.type === "tool_use")
      .map((b) => (b as { id: string }).id);

    if (toolUseIds.length === 0) continue;

    // Must be followed by a user message with matching tool_results
    const next = messages[i + 1];
    if (!next || next.role !== "user") {
      console.warn(
        `[Agent] Truncating messages: assistant at index ${i} has tool_use but no tool_result follows. tool_use ids: ${toolUseIds.join(", ")}`
      );
      // Trim to before this broken assistant message
      return messages.slice(0, i);
    }

    const resultIds = new Set(
      next.content
        .filter((b) => b.type === "tool_result")
        .map((b) => (b as { tool_use_id: string }).tool_use_id)
    );

    const missingIds = toolUseIds.filter((id) => !resultIds.has(id));
    if (missingIds.length > 0) {
      console.warn(
        `[Agent] Truncating messages: tool_result at index ${i + 1} missing ids: ${missingIds.join(", ")}`
      );
      return messages.slice(0, i);
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------
// runAgent — async generator (tool-calling loop)
// ---------------------------------------------------------------------------

/**
 * Runs the Claude tool-calling loop.
 *
 * Yields AgentAction events for UI subscription. Handles:
 * - Streaming text deltas
 * - tool_use blocks: executes tools in order, appends results, loops
 * - Circuit breaker at MAX_ITERATIONS
 * - Abort signal propagation
 */
export async function* runAgent(
  messages: AgentMessage[],
  tools: AgentTool[],
  apiKey: string,
  model: string,
  system?: SystemBlock[],
  signal?: AbortSignal
): AsyncGenerator<AgentAction> {
  // AgentMessage is structurally compatible with AgentRequestMessage
  const currentMessages: AgentRequestMessage[] = messages as AgentRequestMessage[];
  let iterationCount = 0;

  const toolDefinitions: ToolDefinition[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  while (iterationCount < MAX_ITERATIONS) {
    if (signal?.aborted) {
      yield { type: "state_change", state: AgentState.PAUSED };
      return;
    }

    iterationCount++;
    yield { type: "state_change", state: AgentState.THINKING };

    // In-flight state for this API turn
    const textParts = new Map<number, string>();
    const toolBlocks = new Map<
      number,
      { id: string; name: string; partialJson: string }
    >();
    let stopReason: string | null = null;
    let usageEmitted = false;

    // Validate conversation structure before every API call.
    // If a prior turn left orphaned tool_use blocks (e.g. interrupted session,
    // max_tokens cutoff, or persisted corrupted history), truncate to the last
    // valid point so the API doesn't reject the whole request.
    const validatedMessages = validateMessages(currentMessages);
    if (validatedMessages.length !== currentMessages.length) {
      // Replace the runner's working array with the truncated version.
      currentMessages.length = 0;
      currentMessages.push(...validatedMessages);
    }

    for await (const event of sendAgentRequest(
      currentMessages,
      toolDefinitions,
      apiKey,
      model,
      system,
      signal
    )) {
      if (event.type === "error") {
        yield { type: "error", error: event.error };
        yield { type: "state_change", state: AgentState.ERROR };
        return;
      }

      if (event.type === "text_delta") {
        yield { type: "text_delta", text: event.text };
        textParts.set(0, (textParts.get(0) ?? "") + event.text);
      } else if (event.type === "tool_use_start") {
        toolBlocks.set(event.index, {
          id: event.id,
          name: event.name,
          partialJson: "",
        });
        yield {
          type: "tool_call_start",
          toolName: event.name,
          toolUseId: event.id,
        };
        yield { type: "state_change", state: AgentState.TOOL_CALL };
      } else if (event.type === "tool_input_delta") {
        const block = toolBlocks.get(event.index);
        if (block) block.partialJson += event.partial_json;
      } else if (event.type === "usage") {
        usageEmitted = true;
        const usage: TokenUsage = {
          input: event.input_tokens,
          output: event.output_tokens,
          cached: event.cache_read_input_tokens,
        };
        yield { type: "token_usage", usage };
      } else if (event.type === "message_stop") {
        stopReason = event.stop_reason;
      }
    }

    if (!usageEmitted) {
      // Defensive: emit zero usage if SSE ended without a usage event
      yield {
        type: "token_usage",
        usage: { input: 0, output: 0, cached: 0 },
      };
    }

    // Build the assistant content blocks from accumulated state
    const assistantContent: AgentRequestMessage["content"] = [];
    const textAccumulated = textParts.get(0);
    if (textAccumulated && textAccumulated.length > 0) {
      assistantContent.push({ type: "text", text: textAccumulated });
    }
    const orderedToolBlocks = [...toolBlocks.entries()].sort(
      ([a], [b]) => a - b
    );
    for (const [, block] of orderedToolBlocks) {
      assistantContent.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: parseToolInput(block.partialJson),
      });
    }

    // If stop_reason is not "tool_use", strip any tool_use blocks that were
    // partially streamed (e.g. max_tokens cutoff, premature stream close).
    // Storing them without matching tool_results corrupts the conversation
    // for all subsequent API calls.
    if (stopReason !== "tool_use" && orderedToolBlocks.length > 0) {
      const textOnly = assistantContent.filter((b) => b.type !== "tool_use");
      assistantContent.length = 0;
      assistantContent.push(...textOnly);
      orderedToolBlocks.length = 0;
    }

    if (assistantContent.length > 0) {
      currentMessages.push({ role: "assistant", content: assistantContent });
      // Emit the complete assistant content so session.ts can persist it to
      // conversation history (text blocks only if tool_use was stripped above).
      yield { type: "assistant_turn", content: assistantContent };
    }

    // If no tool calls or stop_reason is not tool_use, we are done
    if (stopReason !== "tool_use" || orderedToolBlocks.length === 0) {
      yield { type: "state_change", state: AgentState.COMPLETE };
      return;
    }

    // Execute tools and collect results
    yield { type: "state_change", state: AgentState.TOOL_CALL };

    const toolResultContent: ToolResultContentBlock[] = [];

    for (let toolIdx = 0; toolIdx < orderedToolBlocks.length; toolIdx++) {
      const [, block] = orderedToolBlocks[toolIdx];

      if (signal?.aborted) {
        // Yield error tool_results for all remaining tools so the
        // assistant(tool_use) already in history stays paired.
        for (let ri = toolIdx; ri < orderedToolBlocks.length; ri++) {
          const [, rb] = orderedToolBlocks[ri];
          toolResultContent.push({
            type: "tool_result",
            tool_use_id: rb.id,
            content: [{ type: "text", text: "Aborted by user." }],
            is_error: true,
          });
          yield {
            type: "tool_call_result",
            toolName: rb.name,
            toolUseId: rb.id,
            input: {},
            result: "Aborted by user.",
            isError: true,
          };
        }
        yield { type: "tool_result_turn", content: toolResultContent };
        currentMessages.push({ role: "user", content: toolResultContent });
        yield { type: "state_change", state: AgentState.PAUSED };
        return;
      }

      const tool = tools.find((t) => t.name === block.name);

      if (!tool) {
        const errorText = `Unknown tool: ${block.name}`;
        toolResultContent.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: [{ type: "text", text: errorText }],
          is_error: true,
        });
        yield {
          type: "tool_call_result",
          toolName: block.name,
          toolUseId: block.id,
          input: {},
          result: errorText,
          isError: true,
        };
        continue;
      }

      let resultText: string;
      let resultImage:
        | { media_type: "image/png"; data: string }
        | null = null;
      let isError = false;
      const toolInput = parseToolInput(block.partialJson);

      try {
        const result = await tool.execute(toolInput);
        if (result.type === "text") {
          resultText = result.text;
        } else {
          resultText = "[image]";
          resultImage = { media_type: result.media_type, data: result.data };
        }
      } catch (err) {
        resultText = err instanceof Error ? err.message : "Tool execution failed";
        isError = true;
      }

      if (resultImage !== null) {
        toolResultContent.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: resultImage.data,
              },
            },
          ],
        });
      } else {
        toolResultContent.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: [{ type: "text", text: resultText }],
          is_error: isError || undefined,
        });
      }

      yield {
        type: "tool_call_result",
        toolName: block.name,
        toolUseId: block.id,
        input: toolInput,
        result: resultText,
        isError: isError || undefined,
      };
    }

    // Emit tool result turn so session.ts can store it in conversationHistory.
    // This lets MessageList pair each tool_use with its tool_result (including
    // image results from capture_frame / capture_sequence).
    yield {
      type: "tool_result_turn",
      content: toolResultContent,
    };

    // Append tool results as a user message and loop
    currentMessages.push({ role: "user", content: toolResultContent });
  }

  // Circuit breaker hit
  yield { type: "state_change", state: AgentState.PAUSED };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseToolInput(partialJson: string): Record<string, unknown> {
  if (!partialJson.trim()) return {};
  try {
    const parsed = JSON.parse(partialJson);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
