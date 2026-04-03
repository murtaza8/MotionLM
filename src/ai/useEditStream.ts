import { useCallback, useRef, useState } from "react";

import { useStore } from "@/store";
import { assembleEditContext, assembleMessages } from "@/ai/context-assembler";
import { buildSystemPrompt } from "@/ai/system-prompt";
import { sendEditRequest } from "@/ai/client";
import { parseEditResponse, applyEdit } from "@/ai/diff-parser";

import type { StoreEditActions } from "@/ai/diff-parser";
import type { StoreSnapshot } from "@/ai/context-assembler";
import type { VFSFile } from "@/store";

export interface EditStreamHandle {
  /** Returns true on success, false if an error was set. */
  submit: (instruction: string) => Promise<boolean>;
  cancel: () => void;
  isStreaming: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Shared hook that owns the full AI edit streaming flow.
 * Used by both CommandPalette and PropertiesPanel.
 */
export const useEditStream = (): EditStreamHandle => {
  const apiKey = useStore((s) => s.apiKey);
  const modelId = useStore((s) => s.modelId);

  const setDraftCode = useStore((s) => s.setDraftCode);
  const setCompilationStatus = useStore((s) => s.setCompilationStatus);
  const promoteDraft = useStore((s) => s.promoteDraft);
  const discardDraft = useStore((s) => s.discardDraft);
  const pushSnapshot = useStore((s) => s.pushSnapshot);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);

  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const submit = useCallback(
    async (instruction: string): Promise<boolean> => {
      if (!apiKey) {
        setError("Add your Anthropic API key in Settings (gear icon in toolbar).");
        return false;
      }
      if (!instruction.trim()) {
        setError("Please enter an instruction.");
        return false;
      }

      setError(null);
      setIsStreaming(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Read latest store values at submit time to avoid stale closure issues
      const {
        files,
        activeFilePath,
        selectedElementId,
        selectedFrame,
        temporalMap,
      } = useStore.getState();

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
      const model = modelId;

      let accumulated = "";
      let streamError: string | null = null;

      try {
        const stream = sendEditRequest(messages, apiKey, model, controller.signal);
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
          return false;
        }
        streamError =
          err instanceof Error ? err.message : "Unexpected error during streaming.";
      }

      if (controller.signal.aborted) {
        setIsStreaming(false);
        return false;
      }
      abortControllerRef.current = null;

      if (streamError !== null) {
        setError(streamError);
        setIsStreaming(false);
        return false;
      }

      const parsed = parseEditResponse(accumulated);
      if (!parsed.ok) {
        setError(parsed.error);
        setIsStreaming(false);
        return false;
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
        apiKey,
        model,
        messages,
        store: storeActions,
      });

      setIsStreaming(false);

      if (!applyResult.ok) {
        setError(applyResult.error);
        return false;
      }

      if (parsed.edit.seekToFrame !== undefined) {
        setCurrentFrame(parsed.edit.seekToFrame);
      }
      return true;
    },
    [
      apiKey,
      modelId,
      setDraftCode,
      setCompilationStatus,
      promoteDraft,
      discardDraft,
      pushSnapshot,
      setCurrentFrame,
    ]
  );

  return { submit, cancel, isStreaming, error, clearError };
};
