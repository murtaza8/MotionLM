import { useCallback, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { useStore } from "@/store";
import { useEditStream } from "@/ai/useEditStream";

import { ContextDisplay } from "./ContextDisplay";

export const CommandPalette = () => {
  const commandPaletteOpen = useStore((s) => s.commandPaletteOpen);
  const closeCommandPalette = useStore((s) => s.closeCommandPalette);
  const modelPreference = useStore((s) => s.modelPreference);
  const setModelPreference = useStore((s) => s.setModelPreference);

  const [instruction, setInstruction] = useState("");
  const { submit, cancel, isStreaming, error, clearError } = useEditStream();

  const handleClose = useCallback(() => {
    cancel();
    clearError();
    closeCommandPalette();
  }, [cancel, clearError, closeCommandPalette]);

  const handleSubmit = useCallback(async () => {
    const ok = await submit(instruction);
    if (ok) {
      setInstruction("");
      closeCommandPalette();
    }
  }, [submit, instruction, closeCommandPalette]);

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
