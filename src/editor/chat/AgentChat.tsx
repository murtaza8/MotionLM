import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Square, Coins, Clock, Paperclip, X, Mic } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useShallow } from "zustand/react/shallow";

import { useStore } from "@/store";
import { AgentState } from "@/agent/types";
import { AgentSession } from "@/agent/session";
import { getOrCreateSession, setActiveSession } from "@/agent/active-session";
import { listConversations, loadConversation } from "@/persistence/idb";

import { MessageList } from "./MessageList";
import { ContextPill } from "./ContextPill";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { VoiceInput } from "./VoiceInput";
import type { VoiceInputHandle } from "./VoiceInput";
import { VoiceIndicator } from "./VoiceIndicator";
import { useProactiveAnalysis } from "./useProactiveAnalysis";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STARTER_PROMPTS = [
  "Create a bouncing logo animation",
  "Make a text reveal with spring entrance",
  "Build a lower-third for a news broadcast",
  "Create a 5-second countdown timer",
] as const;

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

/**
 * Persistent right-side chat panel. Contains:
 * - Header with token usage counter, session history popover, and new-session button
 * - Starter prompts (when conversation is empty and API key is set)
 * - Message list (scrollable, when conversation has messages)
 * - Thinking indicator (visible during agent execution)
 * - Input area with context pill, image attachment, voice input, and send/abort button
 */
export const AgentChat = () => {
  const { agentState, apiKey, conversationHistory, proactiveSuggestions, dismissSuggestion } =
    useStore(
      useShallow((s) => ({
        agentState: s.agentState,
        apiKey: s.apiKey,
        conversationHistory: s.conversationHistory,
        proactiveSuggestions: s.proactiveSuggestions,
        dismissSuggestion: s.dismissSuggestion,
      }))
    );

  useProactiveAnalysis();

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Image attachment state
  const [pendingImage, setPendingImage] = useState<{ base64: string; mediaType: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Voice state
  const [voiceActive, setVoiceActive] = useState(false);
  const voiceInputRef = useRef<VoiceInputHandle>(null);

  // Session history popover state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const sessionLoadingRef = useRef(false);

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
    const image = pendingImage;
    setPendingImage(null);

    const session = getOrCreateSession();
    await session.send(text, image !== null ? { imageAttachment: image } : undefined);
  }, [input, isRunning, pendingImage]);

  const handleSendImmediate = useCallback(async (text: string) => {
    if (isRunning) return;
    const session = getOrCreateSession();
    await session.send(text);
  }, [isRunning]);

  const handleAbort = useCallback(() => {
    const session = getOrCreateSession();
    session.abort();
  }, []);

  const handleNewSession = useCallback(() => {
    const newSession = AgentSession.create();
    setActiveSession(newSession);
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

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!imageInputRef.current) return;
    imageInputRef.current.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result !== "string") return;
      const base64 = result.split(",")[1] ?? "";
      setPendingImage({ base64, mediaType: file.type || "image/png" });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleVoiceTranscript = useCallback((text: string, frame: number) => {
    setInput(`[Frame ${frame}] ${text}`);
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionLoadError(null);
    const result = await listConversations();
    setSessions(result.slice(0, 20));
  }, []);

  const handleSessionClick = useCallback(
    async (sessionId: string) => {
      if (sessionLoadingRef.current) return;
      sessionLoadingRef.current = true;
      setSessionLoadError(null);
      const messages = await loadConversation(sessionId);
      sessionLoadingRef.current = false;
      if (messages === null) {
        setSessionLoadError("Session not found");
        return;
      }
      // Abort any running agent before switching
      const currentSession = getOrCreateSession();
      currentSession.abort();
      setActiveSession(null); // force re-creation via resume() on next send
      setPendingImage(null);
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
      {/* Voice input — renders null, handles Cmd+Shift+V globally */}
      <VoiceInput
        ref={voiceInputRef}
        onTranscript={handleVoiceTranscript}
        onActiveChange={setVoiceActive}
        disabled={isRunning}
      />

      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--glass-border-subtle)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <span className="text-xs font-medium uppercase tracking-widest text-[var(--text-tertiary)]">
            Agent
          </span>
        </div>

        <div className="flex items-center gap-2">
          <VoiceIndicator active={voiceActive} />
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

      {/* Starter prompts — shown when API key is set and no conversation yet */}
      {apiKey !== null && conversationHistory.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 gap-4">
          <p className="text-sm font-medium text-[var(--text-primary)]">What would you like to create?</p>
          <div className="grid grid-cols-2 gap-2 w-full">
            {STARTER_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void handleSendImmediate(prompt)}
                disabled={isRunning}
                className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-left text-[var(--text-primary)] hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages — only when conversation has history */}
      {apiKey !== null && conversationHistory.length > 0 && <MessageList />}

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

          {/* Image attachment preview */}
          {pendingImage !== null && (
            <div className="relative inline-block">
              <img
                src={`data:${pendingImage.mediaType};base64,${pendingImage.base64}`}
                alt="Attachment preview"
                className="max-h-12 rounded border border-[var(--glass-border-subtle)]"
              />
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-neutral-700 flex items-center justify-center text-[var(--text-primary)] hover:bg-neutral-600"
                aria-label="Remove image"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          )}

          {/* Textarea + send */}
          <div className="flex items-stretch gap-1.5">
            <textarea
              ref={inputRef}
              className="flex-1 h-full bg-[var(--glass-bg-1)] border border-[var(--glass-border-subtle)] rounded-lg px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-none focus:outline-none focus:border-[var(--glass-border-strong)]"
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

            {/* Mic + paperclip stacked vertically */}
            <div className="flex flex-col gap-1 shrink-0">
              <button
                type="button"
                onClick={() => voiceInputRef.current?.toggle()}
                disabled={isRunning}
                className={`p-2 rounded glass-panel glass-hover disabled:opacity-30 disabled:cursor-not-allowed ${voiceActive ? "glass-tint-red" : ""}`}
                title="Voice input (⌘⇧V)"
              >
                <Mic className={`w-3.5 h-3.5 ${voiceActive ? "text-red-300" : "text-[var(--text-primary)]"}`} />
              </button>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={isRunning || apiKey === null}
                className="p-2 rounded glass-panel glass-hover disabled:opacity-30 disabled:cursor-not-allowed"
                title="Attach image"
              >
                <Paperclip className="w-3.5 h-3.5 text-[var(--text-primary)]" />
              </button>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={handleImageSelect}
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
            Shift+Enter for newline · ⌘⇧V to speak
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
