import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Square, Coins } from "lucide-react";

import { useStore } from "@/store";
import { AgentState } from "@/agent/types";
import { AgentSession } from "@/agent/session";

import { MessageList } from "./MessageList";
import { ContextPill } from "./ContextPill";
import { ThinkingIndicator } from "./ThinkingIndicator";

// ---------------------------------------------------------------------------
// Module-level session reference
// ---------------------------------------------------------------------------

let activeSession: AgentSession | null = null;

const getOrCreateSession = (): AgentSession => {
  if (activeSession === null) {
    activeSession = AgentSession.create();
  }
  return activeSession;
};

// ---------------------------------------------------------------------------
// AgentChat
// ---------------------------------------------------------------------------

/**
 * Persistent right-side chat panel. Contains:
 * - Header with token usage counter and new-session button
 * - Message list (scrollable)
 * - Thinking indicator (visible during agent execution)
 * - Input area with context pill and send/abort button
 */
export const AgentChat = () => {
  const agentState = useStore((s) => s.agentState);
  const tokenUsage = useStore((s) => s.tokenUsage);
  const apiKey = useStore((s) => s.apiKey);

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const totalTokens = tokenUsage.input + tokenUsage.output;

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
          {totalTokens > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] font-mono">
              <Coins className="w-3 h-3" />
              {formatTokenCount(totalTokens)}
              {tokenUsage.cached > 0 && (
                <span className="text-emerald-400">
                  ({formatTokenCount(tokenUsage.cached)} cached)
                </span>
              )}
            </span>
          )}

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
