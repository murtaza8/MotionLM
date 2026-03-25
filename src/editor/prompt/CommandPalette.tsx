import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { useStore } from "@/store";
import { assembleEditContext, assembleMessages } from "@/ai/context-assembler";
import { buildSystemPrompt } from "@/ai/system-prompt";
import { sendEditRequest } from "@/ai/client";
import { parseEditResponse, applyEdit } from "@/ai/diff-parser";

import type { StoreEditActions } from "@/ai/diff-parser";
import type { StoreSnapshot } from "@/ai/context-assembler";
import type { VFSFile } from "@/store";

import { ContextDisplay } from "./ContextDisplay";

const MODEL_IDS: Record<"sonnet" | "opus", string> = {
  sonnet: "claude-sonnet-4-20250514",
  opus: "claude-opus-4-20250514",
};

export const CommandPalette = () => {
  const commandPaletteOpen = useStore((s) => s.commandPaletteOpen);
  const closeCommandPalette = useStore((s) => s.closeCommandPalette);

  const apiKey = useStore((s) => s.apiKey);
  const modelPreference = useStore((s) => s.modelPreference);
  const setApiKey = useStore((s) => s.setApiKey);
  const setModelPreference = useStore((s) => s.setModelPreference);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);

  const setDraftCode = useStore((s) => s.setDraftCode);
  const setCompilationStatus = useStore((s) => s.setCompilationStatus);
  const promoteDraft = useStore((s) => s.promoteDraft);
  const discardDraft = useStore((s) => s.discardDraft);
  const pushSnapshot = useStore((s) => s.pushSnapshot);

  const files = useStore((s) => s.files);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const selectedElementId = useStore((s) => s.selectedElementId);
  const selectedFrame = useStore((s) => s.selectedFrame);
  const temporalMap = useStore((s) => s.temporalMap);

  const [instruction, setInstruction] = useState("");
  const [localApiKey, setLocalApiKey] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync local API key field from store when palette opens
  useEffect(() => {
    if (commandPaletteOpen) {
      setLocalApiKey(apiKey ?? "");
      setError(null);
    }
  }, [commandPaletteOpen, apiKey]);

  const handleClose = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setError(null);
    closeCommandPalette();
  }, [closeCommandPalette]);

  const handleSubmit = useCallback(async () => {
    const effectiveApiKey = localApiKey.trim() || (apiKey ?? "");
    if (!effectiveApiKey) {
      setError("API key is required.");
      return;
    }
    if (!instruction.trim()) {
      setError("Please enter an instruction.");
      return;
    }

    if (localApiKey.trim() && localApiKey.trim() !== apiKey) {
      setApiKey(localApiKey.trim());
    }

    setError(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const storeSnapshot: StoreSnapshot = {
      files: files as Map<string, { activeCode: string }>,
      activeFilePath,
      selectedElementId,
      selectedFrame,
      temporalMap,
    };

    const editContext = assembleEditContext(storeSnapshot);
    const systemPrompt = buildSystemPrompt();
    const messages = assembleMessages(editContext, instruction.trim(), systemPrompt);
    const model = MODEL_IDS[modelPreference];

    let accumulated = "";
    let streamError: string | null = null;

    try {
      const stream = sendEditRequest(messages, effectiveApiKey, model, controller.signal);
      for await (const chunk of stream) {
        if (chunk.type === "text_delta") {
          accumulated += chunk.text;
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
        return;
      }
      streamError =
        err instanceof Error ? err.message : "Unexpected error during streaming.";
    }

    // If aborted during streaming, bail out silently
    if (controller.signal.aborted) {
      setIsStreaming(false);
      return;
    }
    abortControllerRef.current = null;

    if (streamError !== null) {
      setError(streamError);
      setIsStreaming(false);
      return;
    }

    const parsed = parseEditResponse(accumulated);
    if (!parsed.ok) {
      setError(parsed.error);
      setIsStreaming(false);
      return;
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

    if (!applyResult.ok) {
      setError(applyResult.error);
      return;
    }

    if (parsed.edit.seekToFrame !== undefined) {
      setCurrentFrame(parsed.edit.seekToFrame);
    }
    setInstruction("");
    closeCommandPalette();
  }, [
    instruction,
    localApiKey,
    apiKey,
    setApiKey,
    modelPreference,
    files,
    activeFilePath,
    selectedElementId,
    selectedFrame,
    temporalMap,
    setDraftCode,
    setCompilationStatus,
    promoteDraft,
    discardDraft,
    pushSnapshot,
    setCurrentFrame,
    closeCommandPalette,
  ]);

  return (
    <Dialog.Root open={commandPaletteOpen} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed z-50 left-1/2 -translate-x-1/2 top-[20vh] w-full max-w-[580px] glass-modal rounded-xl p-4 flex flex-col gap-3 animate-glass-appear focus:outline-none"
          onEscapeKeyDown={handleClose}
          onInteractOutside={handleClose}
        >
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>

          <ContextDisplay />

          <textarea
            className="w-full bg-[var(--glass-bg-1)] border border-[var(--glass-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-none focus:outline-none focus:border-[var(--glass-border-strong)] min-h-[72px]"
            placeholder="Describe your edit..."
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={isStreaming}
            autoFocus
          />

          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-tertiary)]">Model</span>
            <button
              type="button"
              className={`text-xs px-2 py-1 rounded transition-colors ${
                modelPreference === "sonnet"
                  ? "glass-tint-blue text-blue-300"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
              onClick={() => setModelPreference("sonnet")}
              disabled={isStreaming}
            >
              Sonnet
            </button>
            <button
              type="button"
              className={`text-xs px-2 py-1 rounded transition-colors ${
                modelPreference === "opus"
                  ? "glass-tint-blue text-blue-300"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
              onClick={() => setModelPreference("opus")}
              disabled={isStreaming}
            >
              Opus
            </button>
          </div>

          <input
            type="password"
            className="w-full bg-[var(--glass-bg-1)] border border-[var(--glass-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--glass-border-strong)]"
            placeholder="sk-ant-... (Anthropic API key)"
            value={localApiKey}
            onChange={(e) => setLocalApiKey(e.target.value)}
            disabled={isStreaming}
          />

          <div className="flex items-center justify-between">
            {isStreaming ? (
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
                </span>
                Generating edit...
              </div>
            ) : (
              <div />
            )}
            <button
              type="button"
              className="glass-panel px-4 py-1.5 text-sm text-[var(--text-primary)] rounded-lg disabled:opacity-40 glass-hover"
              onClick={() => void handleSubmit()}
              disabled={isStreaming || !instruction.trim()}
            >
              Apply
            </button>
          </div>

          {error !== null && (
            <div className="glass-well glass-tint-red rounded-lg px-3 py-2 text-xs text-red-300 font-mono break-words">
              {error}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
