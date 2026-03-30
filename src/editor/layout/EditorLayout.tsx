import { useEffect } from "react";
import { Download, History, PanelLeft, PanelRight, PanelBottom, Settings, Sparkles } from "lucide-react";

import { useStore } from "@/store";
import { saveFileToDisk } from "@/persistence/filesystem";

import { FileTreePanel } from "./FileTreePanel";
import { PreviewPanel } from "./PreviewPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { TimelinePanel } from "./TimelinePanel";
import { CommandPalette } from "@/editor/prompt/CommandPalette";
import { VersionHistory } from "@/editor/history/VersionHistory";
import { GenerateChat } from "@/editor/generate/GenerateChat";
import { SettingsPanel } from "@/editor/settings/SettingsPanel";
import { ExportModal } from "@/editor/export/ExportModal";

// ---------------------------------------------------------------------------
// EditorLayout
// ---------------------------------------------------------------------------

export const EditorLayout = () => {
  const editMode = useStore((s) => s.editMode);
  const toggleEditMode = useStore((s) => s.toggleEditMode);
  const setEditMode = useStore((s) => s.setEditMode);
  const clearSelection = useStore((s) => s.clearSelection);
  const isPlaying = useStore((s) => s.isPlaying);
  const setPlaying = useStore((s) => s.setPlaying);

  const undo = useStore((s) => s.undo);

  const commandPaletteOpen = useStore((s) => s.commandPaletteOpen);
  const toggleCommandPalette = useStore((s) => s.toggleCommandPalette);
  const closeCommandPalette = useStore((s) => s.closeCommandPalette);

  const apiKey = useStore((s) => s.apiKey);
  const openSettingsPanel = useStore((s) => s.openSettingsPanel);

  const versionHistoryOpen = useStore((s) => s.versionHistoryOpen);
  const toggleVersionHistory = useStore((s) => s.toggleVersionHistory);

  const generateChatOpen = useStore((s) => s.generateChatOpen);
  const toggleGenerateChat = useStore((s) => s.toggleGenerateChat);

  const openExportModal = useStore((s) => s.openExportModal);

  const fileTreeVisible = useStore((s) => s.fileTreeVisible);
  const propertiesPanelVisible = useStore((s) => s.propertiesPanelVisible);
  const timelineVisible = useStore((s) => s.timelineVisible);
  const toggleFileTree = useStore((s) => s.toggleFileTree);
  const togglePropertiesPanel = useStore((s) => s.togglePropertiesPanel);
  const toggleTimeline = useStore((s) => s.toggleTimeline);

  const selectedElementId = useStore((s) => s.selectedElementId);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      // Cmd+S / Ctrl+S — save active file to disk
      if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const { activeFilePath } = useStore.getState();
        if (activeFilePath) void saveFileToDisk(activeFilePath);
        return;
      }

      // Cmd+K / Ctrl+K — toggle command palette
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Cmd+Z / Ctrl+Z — undo (no shift)
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Cmd+Shift+H / Ctrl+Shift+H — toggle version history
      if (e.key === "h" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        toggleVersionHistory();
        return;
      }

      // Shortcuts below must not fire inside text inputs
      if (inInput) return;

      // Escape — priority: close palette → clear selection → exit edit mode
      if (e.key === "Escape") {
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else if (selectedElementId !== null) {
          clearSelection();
        } else if (editMode) {
          setEditMode(false);
        }
        return;
      }

      // E — toggle edit mode
      if (e.key === "e" && !e.metaKey && !e.ctrlKey) {
        toggleEditMode();
        return;
      }

      // G — toggle generate chat
      if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
        toggleGenerateChat();
        return;
      }

      // Space — toggle play / pause
      if (e.key === " " && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setPlaying(!isPlaying);
        return;
      }

      // 1 — toggle file tree
      if (e.key === "1" && !e.metaKey && !e.ctrlKey) {
        toggleFileTree();
        return;
      }

      // 2 — toggle properties panel
      if (e.key === "2" && !e.metaKey && !e.ctrlKey) {
        togglePropertiesPanel();
        return;
      }

      // 3 — toggle timeline
      if (e.key === "3" && !e.metaKey && !e.ctrlKey) {
        toggleTimeline();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    editMode,
    toggleEditMode,
    setEditMode,
    clearSelection,
    isPlaying,
    setPlaying,
    undo,
    commandPaletteOpen,
    toggleCommandPalette,
    closeCommandPalette,
    selectedElementId,
    toggleVersionHistory,
    toggleGenerateChat,
    toggleFileTree,
    togglePropertiesPanel,
    toggleTimeline,
  ]);

  return (
    <>
      <CommandPalette />
      <VersionHistory />
      <GenerateChat />
      <SettingsPanel />
      <ExportModal />

      {/* Outer shell — flex column filling the viewport */}
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--color-base)]">

        {/* Toolbar */}
        <div className="h-[44px] shrink-0 glass-elevated flex items-center justify-between px-4 border-b border-[var(--glass-border-subtle)]">
          <span className="text-sm font-medium tracking-tight text-[var(--text-primary)]">
            MotionLM
          </span>

          <div className="flex items-center gap-1">
            <span
              className={`text-xs mr-2 ${editMode ? "text-blue-400" : "text-[var(--text-tertiary)]"}`}
            >
              {editMode ? "Edit mode — E to exit" : "E to edit"}
            </span>

            <button
              onClick={toggleGenerateChat}
              aria-label="Toggle generate chat (G)"
              title="Toggle generate chat (G)"
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs glass-hover ${generateChatOpen ? "glass-tint-blue text-blue-300" : "text-[var(--text-secondary)]"}`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate
            </button>

            <button
              onClick={openExportModal}
              aria-label="Export video"
              title="Export video"
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs glass-hover text-[var(--text-secondary)]"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>

            <div className="w-px h-4 bg-[var(--glass-border-subtle)] mx-1" />

            <button
              onClick={toggleFileTree}
              aria-label="Toggle file tree (1)"
              title="Toggle file tree (1)"
              className={`p-1.5 rounded glass-hover ${fileTreeVisible ? "glass-tint-blue" : ""}`}
            >
              <PanelLeft className="w-4 h-4 text-[var(--text-secondary)]" />
            </button>

            <button
              onClick={togglePropertiesPanel}
              aria-label="Toggle properties (2)"
              title="Toggle properties (2)"
              className={`p-1.5 rounded glass-hover ${propertiesPanelVisible ? "glass-tint-blue" : ""}`}
            >
              <PanelRight className="w-4 h-4 text-[var(--text-secondary)]" />
            </button>

            <button
              onClick={toggleTimeline}
              aria-label="Toggle timeline (3)"
              title="Toggle timeline (3)"
              className={`p-1.5 rounded glass-hover ${timelineVisible ? "glass-tint-blue" : ""}`}
            >
              <PanelBottom className="w-4 h-4 text-[var(--text-secondary)]" />
            </button>

            <div className="w-px h-4 bg-[var(--glass-border-subtle)] mx-1" />

            <button
              onClick={toggleVersionHistory}
              aria-label="Toggle version history (⌘⇧H)"
              title="Toggle version history (⌘⇧H)"
              className={`p-1.5 rounded glass-hover ${versionHistoryOpen ? "glass-tint-blue" : ""}`}
            >
              <History className="w-4 h-4 text-[var(--text-secondary)]" />
            </button>

            <div className="w-px h-4 bg-[var(--glass-border-subtle)] mx-1" />

            <button
              onClick={openSettingsPanel}
              aria-label="Settings"
              title="Settings"
              className="relative p-1.5 rounded glass-hover"
            >
              <Settings className="w-4 h-4 text-[var(--text-secondary)]" />
              {!apiKey && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          </div>
        </div>

        {/* No-key banner — visible until API key is configured */}
        {!apiKey && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-300">
            <span>AI features require an Anthropic API key.</span>
            <button
              onClick={openSettingsPanel}
              className="underline underline-offset-2 hover:text-amber-200 transition-colors"
            >
              Configure
            </button>
          </div>
        )}

        {/* Content row — file tree | preview | properties */}
        <div className="relative flex flex-1 min-h-0 overflow-hidden">

          {/* File tree — slides in/out via width transition */}
          <div
            className={`shrink-0 overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ${fileTreeVisible ? "w-[240px]" : "w-0"}`}
          >
            {/* Inner div holds the fixed width so content doesn't reflow during animation */}
            <div className="w-[240px] h-full glass-panel border-r border-[var(--glass-border-subtle)] flex flex-col">
              <div className="px-3 py-2 border-b border-[var(--glass-border-subtle)] shrink-0">
                <span className="text-xs font-medium uppercase tracking-widest text-[var(--text-tertiary)]">
                  Files
                </span>
              </div>
              <FileTreePanel />
            </div>
          </div>

          {/* Preview — always fills remaining space */}
          <div className="flex-1 min-w-0 bg-[var(--color-base)] overflow-hidden">
            <PreviewPanel />
          </div>

          {/* Properties — slides in/out via width transition */}
          <div
            className={`shrink-0 overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ${propertiesPanelVisible ? "w-[280px]" : "w-0"}`}
          >
            <div className="w-[280px] h-full">
              <PropertiesPanel />
            </div>
          </div>
        </div>

        {/* Timeline — slides in/out via height transition */}
        <div
          className={`shrink-0 overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ${timelineVisible ? "h-[160px]" : "h-0"}`}
        >
          <div className="h-[160px]">
            <TimelinePanel />
          </div>
        </div>
      </div>
    </>
  );
};
