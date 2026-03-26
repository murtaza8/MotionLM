import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { useStore } from "@/store";
import { assembleGenerationMessages } from "@/ai/context-assembler";
import { sendEditRequest } from "@/ai/client";
import { parseEditResponse, applyEdit } from "@/ai/diff-parser";

import type { Message } from "@/ai/client";
import type { StoreEditActions } from "@/ai/diff-parser";
import type { VFSFile } from "@/store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MODEL_IDS: Record<"sonnet" | "opus", string> = {
  sonnet: "claude-sonnet-4-20250514",
  opus: "claude-opus-4-20250514",
};

// ---------------------------------------------------------------------------
// GenerateChat
// ---------------------------------------------------------------------------

export const GenerateChat = () => {
  const generateChatOpen = useStore((s) => s.generateChatOpen);
  const closeGenerateChat = useStore((s) => s.closeGenerateChat);

  const apiKey = useStore((s) => s.apiKey);
  const modelPreference = useStore((s) => s.modelPreference);
  const setApiKey = useStore((s) => s.setApiKey);

  const files = useStore((s) => s.files);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const createFile = useStore((s) => s.createFile);
  const setDraftCode = useStore((s) => s.setDraftCode);
  const setCompilationStatus = useStore((s) => s.setCompilationStatus);
  const promoteDraft = useStore((s) => s.promoteDraft);
  const discardDraft = useStore((s) => s.discardDraft);
  const pushSnapshot = useStore((s) => s.pushSnapshot);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  // Raw Message[] used for Claude API — parallel to chatHistory
  const apiHistoryRef = useRef<Message[]>([]);

  const [input, setInput] = useState("");
  const [localApiKey, setLocalApiKey] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");

  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  // Sync local API key field when panel opens
  useEffect(() => {
    if (generateChatOpen) {
      setLocalApiKey(apiKey ?? "");
      setError(null);
    }
  }, [generateChatOpen, apiKey]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, streamingText]);

  const handleClose = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setStreamingText("");
    setError(null);
    closeGenerateChat();
  }, [closeGenerateChat]);

  // Escape key to close
  useEffect(() => {
    if (!generateChatOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [generateChatOpen, handleClose]);

  const handleSubmit = useCallback(async () => {
    const effectiveApiKey = localApiKey.trim() || (apiKey ?? "");
    if (!effectiveApiKey) {
      setError("API key is required.");
      return;
    }
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      setError("Please enter a description.");
      return;
    }

    if (localApiKey.trim() && localApiKey.trim() !== apiKey) {
      setApiKey(localApiKey.trim());
    }

    setError(null);
    setIsStreaming(true);
    setStreamingText("");

    // Append user message to visible chat
    const userMessage: ChatMessage = { role: "user", content: trimmedInput };
    setChatHistory((prev) => [...prev, userMessage]);
    setInput("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Get current source for follow-up messages
    const currentFilePath = activeFilePath ?? "/main.tsx";
    const currentSource =
      apiHistoryRef.current.length > 0
        ? (files.get(currentFilePath)?.activeCode ?? null)
        : null;

    // Build messages for Claude
    const messages = assembleGenerationMessages(
      apiHistoryRef.current,
      trimmedInput,
      currentSource
    );

    const model = MODEL_IDS[modelPreference];
    let accumulated = "";
    let streamError: string | null = null;

    try {
      const stream = sendEditRequest(messages, effectiveApiKey, model, controller.signal);
      for await (const chunk of stream) {
        if (chunk.type === "text_delta") {
          accumulated += chunk.text;
          setStreamingText(accumulated);
        } else if (chunk.type === "error") {
          streamError = chunk.error;
          break;
        } else if (chunk.type === "message_stop") {
          break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setIsStreaming(false);
        setStreamingText("");
        return;
      }
      streamError =
        err instanceof Error ? err.message : "Unexpected error during streaming.";
    }

    if (controller.signal.aborted) {
      setIsStreaming(false);
      setStreamingText("");
      return;
    }
    abortControllerRef.current = null;

    if (streamError !== null) {
      setError(streamError);
      setIsStreaming(false);
      setStreamingText("");
      return;
    }

    const parsed = parseEditResponse(accumulated);
    if (!parsed.ok) {
      setError(parsed.error);
      setIsStreaming(false);
      setStreamingText("");
      return;
    }

    // Ensure /main.tsx exists in VFS before applying
    const targetPath = parsed.edit.file;
    if (!files.has(targetPath)) {
      createFile(targetPath, "");
      setActiveFile(targetPath);
    } else if (activeFilePath !== targetPath) {
      setActiveFile(targetPath);
    }

    const storeActions: StoreEditActions = {
      setDraftCode,
      setCompilationStatus: setCompilationStatus as (
        path: string,
        status: VFSFile["compilationStatus"],
        error?: string
      ) => void,
      promoteDraft,
      discardDraft,
      pushSnapshot,
    };

    const applyResult = await applyEdit({
      edit: parsed.edit,
      apiKey: effectiveApiKey,
      model,
      messages,
      store: storeActions,
    });

    setIsStreaming(false);
    setStreamingText("");

    if (!applyResult.ok) {
      setError(applyResult.error);
      return;
    }

    // Commit this exchange to API history for follow-ups
    const assistantApiMessage: Message = {
      role: "assistant",
      content: accumulated,
    };
    // On first message, messages[0] is the full system+instruction user turn
    // On follow-ups, messages already contains history + new user turn
    if (apiHistoryRef.current.length === 0) {
      // Store first user turn (with system prompt embedded) and assistant response
      apiHistoryRef.current = [...messages, assistantApiMessage];
    } else {
      // The new user turn was the last element added by assembleGenerationMessages
      apiHistoryRef.current = [...messages, assistantApiMessage];
    }

    // Add assistant explanation to visible chat
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: parsed.edit.explanation,
    };
    setChatHistory((prev) => [...prev, assistantMessage]);
  }, [
    input,
    localApiKey,
    apiKey,
    setApiKey,
    modelPreference,
    files,
    activeFilePath,
    setActiveFile,
    createFile,
    setDraftCode,
    setCompilationStatus,
    promoteDraft,
    discardDraft,
    pushSnapshot,
  ]);

  if (!generateChatOpen) return null;

  return (
    <div className="absolute inset-y-0 left-0 z-40 flex flex-col w-[360px] glass-modal border-r border-[var(--glass-border-subtle)] shadow-[var(--shadow-glass-lg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--glass-border-subtle)] shrink-0">
        <span className="text-sm font-medium text-[var(--text-primary)]">Generate</span>
        <button
          type="button"
          onClick={handleClose}
          className="p-1 rounded glass-hover text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          aria-label="Close generate panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* API key input (shown only when no key is set) */}
      {!apiKey && (
        <div className="px-4 pt-3 shrink-0">
          <input
            type="password"
            className="w-full bg-[var(--glass-bg-1)] border border-[var(--glass-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--glass-border-strong)]"
            placeholder="sk-ant-... (Anthropic API key)"
            value={localApiKey}
            onChange={(e) => setLocalApiKey(e.target.value)}
            disabled={isStreaming}
          />
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-0">
        {chatHistory.length === 0 && !isStreaming && (
          <p className="text-xs text-[var(--text-tertiary)] text-center mt-8 leading-relaxed">
            Describe the video you want to create.<br />
            Claude will generate a complete Remotion composition.
          </p>
        )}

        {chatHistory.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
              {msg.role === "user" ? "You" : "Claude"}
            </span>
            <div
              className={`text-sm rounded-lg px-3 py-2 max-w-full break-words leading-relaxed ${
                msg.role === "user"
                  ? "glass-tint-blue text-[var(--text-primary)]"
                  : "glass-well text-[var(--text-secondary)]"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Streaming in-progress bubble */}
        {isStreaming && (
          <div className="flex flex-col gap-1 items-start">
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
              Claude
            </span>
            <div className="glass-well rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] max-w-full break-words leading-relaxed">
              {streamingText.length > 0 ? (
                <span className="opacity-60">Generating...</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
                  </span>
                  Thinking...
                </span>
              )}
            </div>
          </div>
        )}

        {/* Error display */}
        {error !== null && (
          <div className="glass-well glass-tint-red rounded-lg px-3 py-2 text-xs text-red-300 font-mono break-words">
            {error}
          </div>
        )}

        <div ref={scrollAnchorRef} />
      </div>

      {/* Input area */}
      <div className="px-4 pb-4 pt-2 shrink-0 border-t border-[var(--glass-border-subtle)] flex flex-col gap-2">
        <textarea
          className="w-full bg-[var(--glass-bg-1)] border border-[var(--glass-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-none focus:outline-none focus:border-[var(--glass-border-strong)] min-h-[72px]"
          placeholder={
            chatHistory.length === 0
              ? "Create a 5-second text animation that says Hello World..."
              : "Make a follow-up change..."
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          disabled={isStreaming}
          autoFocus
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Enter to send · Shift+Enter for newline · Esc to close
          </span>
          <button
            type="button"
            className="glass-panel px-4 py-1.5 text-sm text-[var(--text-primary)] rounded-lg disabled:opacity-40 glass-hover"
            onClick={() => void handleSubmit()}
            disabled={isStreaming || !input.trim()}
          >
            {chatHistory.length === 0 ? "Generate" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
};
