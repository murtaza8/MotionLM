import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Eye, EyeOff } from "lucide-react";

import { useStore } from "@/store";

export const SettingsPanel = () => {
  const settingsPanelOpen = useStore((s) => s.settingsPanelOpen);
  const closeSettingsPanel = useStore((s) => s.closeSettingsPanel);
  const apiKey = useStore((s) => s.apiKey);
  const modelPreference = useStore((s) => s.modelPreference);
  const setApiKey = useStore((s) => s.setApiKey);
  const setModelPreference = useStore((s) => s.setModelPreference);

  const [localKey, setLocalKey] = useState("");
  const [localModel, setLocalModel] = useState<"sonnet" | "opus">("sonnet");
  const [showKey, setShowKey] = useState(false);

  // Sync local state from store when panel opens
  useEffect(() => {
    if (settingsPanelOpen) {
      setLocalKey(apiKey ?? "");
      setLocalModel(modelPreference);
      setShowKey(false);
    }
  }, [settingsPanelOpen, apiKey, modelPreference]);

  const handleSave = () => {
    const trimmed = localKey.trim();
    setApiKey(trimmed || null);
    setModelPreference(localModel);
    closeSettingsPanel();
  };

  return (
    <Dialog.Root
      open={settingsPanelOpen}
      onOpenChange={(open) => !open && closeSettingsPanel()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed z-50 left-1/2 -translate-x-1/2 top-[20vh] w-full max-w-[420px] glass-modal rounded-xl p-5 flex flex-col gap-4 animate-glass-appear focus:outline-none"
          onEscapeKeyDown={closeSettingsPanel}
          onInteractOutside={closeSettingsPanel}
        >
          <Dialog.Title className="text-sm font-medium text-[var(--text-primary)]">
            Settings
          </Dialog.Title>

          {/* API Key */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-widest text-[var(--text-tertiary)]">
              Anthropic API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                className="w-full bg-[var(--glass-bg-1)] border border-[var(--glass-border-subtle)] rounded-lg px-3 py-2 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--glass-border-strong)]"
                placeholder="sk-ant-..."
                value={localKey}
                onChange={(e) => setLocalKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Stored in localStorage. Never sent anywhere except Anthropic's API.
            </p>
          </div>

          {/* Model */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-widest text-[var(--text-tertiary)]">
              Model
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className={`px-3 py-1.5 rounded text-xs transition-colors ${
                  localModel === "sonnet"
                    ? "glass-tint-blue text-blue-300"
                    : "glass-well text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                onClick={() => setLocalModel("sonnet")}
              >
                Sonnet
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded text-xs transition-colors ${
                  localModel === "opus"
                    ? "glass-tint-blue text-blue-300"
                    : "glass-well text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                onClick={() => setLocalModel("opus")}
              >
                Opus
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={closeSettingsPanel}
              className="px-3 py-1.5 rounded text-sm text-[var(--text-secondary)] glass-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 rounded text-sm glass-panel glass-hover text-[var(--text-primary)]"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
