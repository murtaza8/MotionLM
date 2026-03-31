import type { AgentMessage } from "./types";
import type { SystemBlock } from "@/ai/client";

// ---------------------------------------------------------------------------
// CacheManagerState — tracked per session (not persisted to store)
// ---------------------------------------------------------------------------

export interface CacheManagerState {
  /** Number of accepted edits since the last profile update injected into the
   *  system prompt. Reset when profile is propagated. */
  editsSinceProfileUpdate: number;
}

export const initialCacheManagerState = (): CacheManagerState => ({
  editsSinceProfileUpdate: 0,
});

// ---------------------------------------------------------------------------
// Profile update gating
// ---------------------------------------------------------------------------

const PROFILE_UPDATE_INTERVAL = 10;

/**
 * Returns true if the profile should be propagated to the system prompt.
 * Always true at session start (count === 0) and every 10th accepted edit.
 */
export function shouldUpdateProfile(state: CacheManagerState): boolean {
  return (
    state.editsSinceProfileUpdate === 0 ||
    state.editsSinceProfileUpdate >= PROFILE_UPDATE_INTERVAL
  );
}

export function recordEdit(
  state: CacheManagerState
): CacheManagerState {
  return {
    editsSinceProfileUpdate: state.editsSinceProfileUpdate + 1,
  };
}

export function recordProfileUpdate(
  _state: CacheManagerState
): CacheManagerState {
  return { editsSinceProfileUpdate: 0 };
}

// ---------------------------------------------------------------------------
// applyCacheControl
// ---------------------------------------------------------------------------

/**
 * Annotates system blocks and conversation messages with prompt caching
 * breakpoints.
 *
 * Rules:
 * 1. System prompt — always add cache_control to the last block (most stable
 *    content; tool definitions, Remotion API, style profile all live here).
 * 2. Conversation history — add cache_control to the last content block of
 *    the most recent assistant message. Remove any previous conversation
 *    breakpoints first (only one rotating conversation breakpoint allowed).
 *    Max 4 total breakpoints per request — system gets 1, conversation gets 1.
 */
export function applyCacheControl(
  messages: AgentMessage[],
  systemBlocks: SystemBlock[]
): { messages: AgentMessage[]; system: SystemBlock[] } {
  // --- System: add breakpoint to last block ---
  const annotatedSystem: SystemBlock[] = systemBlocks.map((b, i) => {
    const isLast = i === systemBlocks.length - 1;
    if (isLast) {
      return { ...b, cache_control: { type: "ephemeral" as const } };
    }
    // Remove any stale cache_control from non-last blocks
    const { cache_control: _dropped, ...rest } = b;
    return rest as SystemBlock;
  });

  if (annotatedSystem.length === 0) {
    return { messages, system: annotatedSystem };
  }

  // --- Messages: strip old conversation breakpoints, add new one ---
  // Deep-clone message array so we don't mutate caller's state
  const clonedMessages: AgentMessage[] = messages.map((msg) => ({
    ...msg,
    content: msg.content.map((block) => {
      // Strip any existing cache_control from text and tool_use blocks
      if (block.type === "text" || block.type === "tool_use" || block.type === "image") {
        const { cache_control: _dropped, ...rest } = block as typeof block & {
          cache_control?: unknown;
        };
        return rest as typeof block;
      }
      return block;
    }),
  }));

  // Find the last assistant message and annotate its last content block
  let lastAssistantIdx = -1;
  for (let i = clonedMessages.length - 1; i >= 0; i--) {
    if (clonedMessages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx !== -1) {
    const assistantMsg = clonedMessages[lastAssistantIdx];
    const content = [...assistantMsg.content];
    const lastBlockIdx = content.length - 1;

    if (lastBlockIdx >= 0) {
      const lastBlock = content[lastBlockIdx];
      // Only text and tool_use blocks can carry cache_control in the messages array
      if (lastBlock.type === "text" || lastBlock.type === "tool_use") {
        content[lastBlockIdx] = {
          ...lastBlock,
          cache_control: { type: "ephemeral" },
        } as typeof lastBlock;
      }
    }

    clonedMessages[lastAssistantIdx] = { ...assistantMsg, content };
  }

  return { messages: clonedMessages, system: annotatedSystem };
}

// ---------------------------------------------------------------------------
// buildToolsWithCacheControl
// ---------------------------------------------------------------------------

/**
 * Optionally marks the last tool definition with cache_control so the tool
 * list is also cached alongside the system prompt. Call only once per session
 * start since tool definitions must not change mid-session.
 */
export function buildToolsWithCacheControl<
  T extends { name: string; description: string; input_schema: Record<string, unknown> }
>(tools: T[]): (T & { cache_control?: { type: "ephemeral" } })[] {
  return tools.map((t, i) => {
    if (i === tools.length - 1) {
      return { ...t, cache_control: { type: "ephemeral" as const } };
    }
    return t;
  });
}
