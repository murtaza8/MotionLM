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
  private isFirstTurn = true;
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
    session.isFirstTurn = false;
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
        : "claude-sonnet-4-20250514";

    // Build snapshot once — avoid stale reads mid-async
    const snapshot: AgentStoreSnapshot = {
      files: store.files,
      activeFilePath: store.activeFilePath,
      selectedElementId: store.selectedElementId,
      selectedFrame: store.selectedFrame,
      temporalMap: store.temporalMap,
    };

    // Build user message — full context on first turn, lightweight follow-ups
    const userMessage: AgentMessage = this.isFirstTurn
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
    const allMessages: AgentMessage[] = [
      ...conversationHistory,
      userMessage,
    ];
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
            s.removePendingToolCall(action.toolUseId);
            s.incrementIteration();
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
    } finally {
      this.abortController = null;
    }

    this.isFirstTurn = false;
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
