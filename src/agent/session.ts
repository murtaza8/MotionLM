import { useStore } from "@/store";
import { buildAgentSystemPrompt } from "@/ai/system-prompt";
import { ALL_TOOLS } from "./tools/index";
import { runAgent } from "./runner";
import {
  buildAgentUserMessage,
  buildFollowUpUserMessage,
} from "./context";
import {
  applyCacheControl,
  buildToolsWithCacheControl,
  initialCacheManagerState,
  recordEdit,
  recordProfileUpdate,
  shouldUpdateProfile,
} from "./cache-manager";
import { appendEditJournalEntry } from "@/persistence/idb";
import { AgentState } from "./types";

import type { AgentMessage, TextContentBlock } from "./types";
import type { AgentStoreSnapshot } from "./context";
import type { CacheManagerState } from "./cache-manager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns history trimmed to the last "clean" assistant message — one that
 * has NO tool_use blocks (i.e., a text-only final response with stop_reason
 * "end_turn"). This is the only safe cut point for appending a new user
 * message:
 *
 * - Any assistant message with tool_use blocks requires a user(tool_result)
 *   message to follow it immediately. Cutting there and appending a new user
 *   instruction instead produces an `invalid_request_error` 400.
 * - Trailing orphaned user messages (failed sends) are also dropped, since
 *   consecutive user messages are equally invalid.
 *
 * If no clean cut point exists (entire history is corrupted), returns []
 * so the caller falls back to a full-context first-turn message.
 */
function trimToValidConversation(history: AgentMessage[]): AgentMessage[] {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "assistant") continue;
    const hasToolUse = history[i].content.some((b) => b.type === "tool_use");
    if (!hasToolUse) {
      // Clean end_turn response — safe to append a new user message here.
      return history.slice(0, i + 1);
    }
    // This assistant message has tool_use blocks — cutting here would leave
    // them unmatched. Keep searching backwards for an earlier clean stop.
  }
  return [];
}

// ---------------------------------------------------------------------------
// AgentSession
// ---------------------------------------------------------------------------

/**
 * Manages one conversation session: context assembly, cache control,
 * runner lifecycle, and store dispatch.
 *
 * One session per browser tab. Create a new instance with `AgentSession.create()`
 * after calling `store.resetSession()`.
 */
export class AgentSession {
  private abortController: AbortController | null = null;
  private cacheState: CacheManagerState = initialCacheManagerState();
  private readonly toolsWithCache = buildToolsWithCacheControl(ALL_TOOLS);

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  static create(): AgentSession {
    const session = new AgentSession();
    useStore.getState().resetSession();
    return session;
  }

  /**
   * Create a session that continues the conversation already in the store
   * (e.g. restored from IDB on page load). Does NOT call resetSession —
   * conversationHistory and activeSessionId are preserved.
   */
  static resume(): AgentSession {
    const session = new AgentSession();
    // Reset only transient per-session state, leave history + sessionId intact.
    useStore.setState({
      agentState: AgentState.IDLE,
      pendingToolCalls: [],
      iterationCount: 0,
      thinkLog: [],
    });
    return session;
  }

  // ---------------------------------------------------------------------------
  // send
  // ---------------------------------------------------------------------------

  /**
   * Send a user message and run the agent loop.
   * Dispatches all state changes, streamed text, tool results, and token
   * usage to the Zustand store.
   */
  async send(userText: string): Promise<void> {
    const store = useStore.getState();

    if (
      store.agentState === AgentState.THINKING ||
      store.agentState === AgentState.TOOL_CALL
    ) {
      return; // Already running — caller should abort first
    }

    const { apiKey, modelPreference, conversationHistory } = store;

    if (!apiKey) {
      store.setAgentState(AgentState.ERROR);
      return;
    }

    const model =
      modelPreference === "opus"
        ? "claude-opus-4-6"
        : "claude-sonnet-4-6";

    // Build snapshot once — avoid stale reads mid-async
    const snapshot: AgentStoreSnapshot = {
      files: store.files,
      activeFilePath: store.activeFilePath,
      selectedElementId: store.selectedElementId,
      selectedFrame: store.selectedFrame,
      temporalMap: store.temporalMap,
    };

    // Trim orphaned trailing user messages from any prior failed send.
    // Consecutive user messages cause a 400 from the Anthropic API and corrupt
    // all subsequent turns. Trimming to the last assistant message restores a
    // valid alternating structure before appending the new user message.
    const trimmedHistory = trimToValidConversation(conversationHistory);
    const hasSuccessfulHistory = trimmedHistory.length > 0;

    // Use full context when there is no prior successful assistant turn so
    // Claude always receives file content, even on retry after a failed first send.
    const userMessage: AgentMessage = !hasSuccessfulHistory
      ? buildAgentUserMessage(snapshot, userText)
      : buildFollowUpUserMessage(snapshot, userText);

    // Append user message to history
    store.appendMessage(userMessage);

    // Build system prompt (with profile if due)
    const profileDue = shouldUpdateProfile(this.cacheState);
    const systemBlocks = buildAgentSystemPrompt(
      profileDue ? undefined : undefined // profile store is Phase C — placeholder
    );
    if (profileDue) {
      this.cacheState = recordProfileUpdate(this.cacheState);
    }

    // Apply cache control breakpoints
    const allMessages: AgentMessage[] = [...trimmedHistory, userMessage];
    const { messages: cachedMessages, system: cachedSystem } =
      applyCacheControl(allMessages, systemBlocks);

    // Set up abort
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Run the agent loop
    try {
      for await (const action of runAgent(
        cachedMessages as AgentMessage[],
        this.toolsWithCache,
        apiKey,
        model,
        cachedSystem,
        signal
      )) {
        // Re-read store on each action (state may have changed)
        const s = useStore.getState();

        switch (action.type) {
          case "state_change":
            s.setAgentState(action.state);
            break;

          case "text_delta":
            // Text streams to MessageList via conversationHistory once
            // assistant_turn fires — no intermediate state needed here.
            break;

          case "tool_call_start":
            s.addPendingToolCall(action.toolUseId);
            break;

          case "tool_call_result": {
            // Batch remove + increment into a single set() to avoid two re-renders.
            useStore.setState((prev) => ({
              pendingToolCalls: prev.pendingToolCalls.filter(
                (id) => id !== action.toolUseId
              ),
              iterationCount: prev.iterationCount + 1,
            }));
            // Only count real edits toward the profile cache update interval.
            // The think tool is zero-cost and should not advance the counter.
            if (action.toolName !== "think") {
              this.cacheState = recordEdit(this.cacheState);
            }
            if (action.toolName === "edit_file" || action.toolName === "create_file") {
              const input = action.input as { path?: string };
              const lastUserMsg = [...s.conversationHistory]
                .reverse()
                .find((m) => m.role === "user");
              const instruction =
                lastUserMsg?.content
                  .find(
                    (b): b is TextContentBlock =>
                      b.type === "text" && b.text.trim().length > 0
                  )
                  ?.text.slice(0, 200) ?? "unknown";
              void appendEditJournalEntry({
                sessionId: s.activeSessionId ?? "unknown",
                instruction,
                elementTargeted: s.selectedElementId ?? null,
                filePath:
                  typeof input.path === "string"
                    ? input.path
                    : s.activeFilePath ?? "",
                wasAccepted: action.isError !== true,
                compilationAttempts: 1,
                errorTypes: action.isError ? [action.result.slice(0, 100)] : [],
                timestamp: Date.now(),
              });
            }
            break;
          }

          case "assistant_turn":
            // Full content (text + tool_use blocks) for this API turn.
            // Append to conversation history so subsequent turns have complete context.
            s.appendMessage({
              role: "assistant",
              content: action.content,
            });
            break;

          case "tool_result_turn":
            // Tool result blocks for this batch of tool calls.
            // Stored as a user message so MessageList can pair each tool_use
            // with its result (including image blocks from capture_frame).
            s.appendMessage({
              role: "user",
              content: action.content,
            });
            break;

          case "token_usage":
            s.setTokenUsage(action.usage);
            break;

          case "error":
            s.setAgentState(AgentState.ERROR);
            break;
        }
      }
    } catch {
      // Unhandled exception from the generator (e.g. network drop mid-stream).
      // Recover agentState so the UI unlocks and the user can retry.
      useStore.getState().setAgentState(AgentState.ERROR);
    } finally {
      this.abortController = null;
    }
  }

  // ---------------------------------------------------------------------------
  // abort
  // ---------------------------------------------------------------------------

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
    useStore.getState().setAgentState(AgentState.PAUSED);
  }

  // ---------------------------------------------------------------------------
  // isRunning
  // ---------------------------------------------------------------------------

  get isRunning(): boolean {
    return this.abortController !== null;
  }
}
