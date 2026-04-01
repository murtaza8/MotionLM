import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Square, Coins, Clock } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useShallow } from "zustand/react/shallow";

import { useStore } from "@/store";
import { AgentState } from "@/agent/types";
import { AgentSession } from "@/agent/session";
import { listConversations, loadConversation } from "@/persistence/idb";

import { MessageList } from "./MessageList";
import { ContextPill } from "./ContextPill";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { useProactiveAnalysis } from "./useProactiveAnalysis";

// ---------------------------------------------------------------------------
// Module-level session reference
// ---------------------------------------------------------------------------

let activeSession: AgentSession | null = null;

const getOrCreateSession = (): AgentSession => {
  if (activeSession === null) {
    const { conversationHistory, activeSessionId } = useStore.getState();
    const isRestored = conversationHistory.length > 0 && activeSessionId !== null;
    activeSession = isRestored ? AgentSession.resume() : AgentSession.create();
  }
  return activeSession;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionSummary {
  sessionId: string;
  preview: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}

// ---------------------------------------------------------------------------
// AgentChat
// ---------------------------------------------------------------------------

/**
 * Persistent right-side chat panel. Contains:
 * - Header with token usage counter, session history popover, and new-session button
 * - Message list (scrollable)
 * - Thinking indicator (visible during agent execution)
 * - Input area with context pill and send/abort button
 */
// ---------------------------------------------------------------------------
// TokenBadge — isolated component so token usage updates don't re-render
// the entire AgentChat tree.
// ---------------------------------------------------------------------------

const TokenBadge = () => {
  const tokenUsage = useStore((s) => s.tokenUsage);
  const totalTokens = tokenUsage.input + tokenUsage.output;

  if (totalTokens === 0) return null;
  return (
    <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] font-mono">
      <Coins className="w-3 h-3" />
      {formatTokenCount(totalTokens)}
      {tokenUsage.cached > 0 && (
        <span className="text-emerald-400">
          ({formatTokenCount(tokenUsage.cached)} cached)
        </span>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// AgentChat
// ---------------------------------------------------------------------------

export const AgentChat = () => {
  const { agentState, apiKey, proactiveSuggestions, dismissSuggestion } =
    useStore(
      useShallow((s) => ({
        agentState: s.agentState,
        apiKey: s.apiKey,
        proactiveSuggestions: s.proactiveSuggestions,
        dismissSuggestion: s.dismissSuggestion,
      }))
    );

  useProactiveAnalysis();

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Session history popover state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);

  const isRunning =
    agentState === AgentState.THINKING || agentState === AgentState.TOOL_CALL;

  const canSend = input.trim().length > 0 && !isRunning && apiKey !== null;

  // Expose inputRef globally so EditorLayout can focus it on Cmd+K
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__agentChatInputRef = inputRef;
    return () => {
      delete (window as unknown as Record<string, unknown>).__agentChatInputRef;
    };
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isRunning) return;

    setInput("");
    const session = getOrCreateSession();
    await session.send(text);
  }, [input, isRunning]);

  const handleAbort = useCallback(() => {
    activeSession?.abort();
  }, []);

  const handleNewSession = useCallback(() => {
    activeSession?.abort();
    activeSession = AgentSession.create();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (canSend) void handleSend();
      }
      if (e.key === "Escape" && isRunning) {
        e.preventDefault();
        e.stopPropagation();
        handleAbort();
      }
    },
    [canSend, handleSend, isRunning, handleAbort]
  );

  const loadSessions = useCallback(async () => {
    setSessionLoadError(null);
    const result = await listConversations();
    setSessions(result.slice(0, 20));
  }, []);

  const handleSessionClick = useCallback(
    async (sessionId: string) => {
      setSessionLoadError(null);
      const messages = await loadConversation(sessionId);
      if (messages === null) {
        setSessionLoadError("Session not found");
        return;
      }
      // Abort any running agent before switching — prevents it from appending
      // messages to the newly restored conversation.
      activeSession?.abort();
      activeSession = null; // force re-creation via resume() on next send
      useStore.setState({
        conversationHistory: messages,
        activeSessionId: sessionId,
        agentState: AgentState.IDLE,
        pendingToolCalls: [],
      });
      setHistoryOpen(false);
    },
    []
  );

  return (
    <div className="flex flex-col h-full glass-panel border-l border-[var(--glass-border-subtle)]">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--glass-border-subtle)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <span className="text-xs font-medium uppercase tracking-widest text-[var(--text-tertiary)]">
            Agent
          </span>
        </div>

        <div className="flex items-center gap-2">
          <TokenBadge />

          {/* Session history popover */}
          <Popover.Root
            open={historyOpen}
            onOpenChange={(open) => {
              setHistoryOpen(open);
              if (open) void loadSessions();
            }}
          >
            <Popover.Trigger asChild>
              <button
                type="button"
                className="text-[var(--text-tertiary)] glass-hover rounded p-1"
                title="Session history"
              >
                <Clock className="w-3 h-3" />
              </button>
            </Popover.Trigger>

            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="end"
                sideOffset={6}
                className="z-50 w-72 rounded-lg glass-panel border border-[var(--glass-border-subtle)] shadow-xl p-2 focus:outline-none"
              >
                <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--text-tertiary)] px-1 pb-1.5">
                  Recent sessions
                </p>

                {sessionLoadError !== null && (
                  <p className="text-[10px] text-red-400 px-1 pb-1">
                    {sessionLoadError}
                  </p>
                )}

                {sessions.length === 0 && sessionLoadError === null && (
                  <p className="text-[10px] text-[var(--text-tertiary)] px-1 py-2">
                    No sessions yet.
                  </p>
                )}

                <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
                  {sessions.map((s) => (
                    <button
                      key={s.sessionId}
                      type="button"
                      onClick={() => void handleSessionClick(s.sessionId)}
                      className="w-full text-left rounded px-2 py-1.5 glass-hover flex flex-col gap-0.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                          {formatRelativeDate(s.createdAt)}
                        </span>
                        <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                          {s.messageCount} messages
                        </span>
                      </div>
                      <span className="text-xs text-[var(--text-primary)] truncate">
                        {s.preview}
                      </span>
                    </button>
                  ))}
                </div>

                <Popover.Arrow className="fill-[var(--glass-border-subtle)]" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <button
            type="button"
            onClick={handleNewSession}
            className="text-[10px] text-[var(--text-tertiary)] glass-hover rounded px-1.5 py-0.5"
            title="New session"
          >
            New
          </button>
        </div>
      </div>

      {/* No API key state */}
      {apiKey === null && (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-xs text-[var(--text-tertiary)] leading-relaxed">
              Set an Anthropic API key in Settings to use the agent chat.
            </span>
            <button
              type="button"
              onClick={() => useStore.getState().openSettingsPanel()}
              className="text-xs text-blue-300 underline underline-offset-2"
            >
              Open Settings
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      {apiKey !== null && <MessageList />}

      {/* Thinking indicator */}
      {apiKey !== null && (
        <div className="shrink-0 px-3">
          <ThinkingIndicator />
        </div>
      )}

      {/* Proactive suggestion cards */}
      {apiKey !== null && proactiveSuggestions.length > 0 && (
        <div className="shrink-0 px-2 pb-1 flex flex-col gap-1.5">
          {proactiveSuggestions.slice(0, 2).map((suggestion) => (
            <div
              key={suggestion.id}
              className="rounded-lg bg-amber-950/40 border border-amber-700/50 px-2.5 py-2 flex flex-col gap-1.5"
            >
              <p className="text-xs text-amber-200 leading-snug">
                {suggestion.message}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const session = getOrCreateSession();
                    void session.send(suggestion.applyInstruction);
                    dismissSuggestion(suggestion.id);
                  }}
                  className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-700/60 text-amber-100 hover:bg-amber-700/80 transition-colors"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => dismissSuggestion(suggestion.id)}
                  className="text-[10px] text-amber-400/70 hover:text-amber-300 ml-auto"
                  title="Dismiss"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      {apiKey !== null && (
        <div className="shrink-0 border-t border-[var(--glass-border-subtle)] p-2 flex flex-col gap-1.5">
          {/* Context pill row */}
          <div className="flex items-center gap-1.5 min-h-[20px]">
            <ContextPill />
          </div>

          {/* Textarea + send */}
          <div className="flex items-end gap-1.5">
            <textarea
              ref={inputRef}
              rows={2}
              className="flex-1 bg-[var(--glass-bg-1)] border border-[var(--glass-border-subtle)] rounded-lg px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-none focus:outline-none focus:border-[var(--glass-border-strong)]"
              placeholder={
                isRunning
                  ? "Agent is working... Escape to abort"
                  : "Describe what to create or change..."
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning}
            />

            {isRunning ? (
              <button
                type="button"
                onClick={handleAbort}
                className="shrink-0 p-2 rounded glass-well glass-tint-red glass-hover"
                title="Abort (Escape)"
              >
                <Square className="w-3.5 h-3.5 text-red-300" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!canSend}
                className="shrink-0 p-2 rounded glass-panel glass-hover disabled:opacity-30 disabled:cursor-not-allowed"
                title="Send (Enter)"
              >
                <Send className="w-3.5 h-3.5 text-[var(--text-primary)]" />
              </button>
            )}
          </div>

          <span className="text-[10px] text-[var(--text-tertiary)]">
            Shift+Enter for newline
          </span>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokenCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function formatRelativeDate(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;

  if (timestamp >= todayStart) return "Today";
  if (timestamp >= yesterdayStart) return "Yesterday";

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
