import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { parseTemporalMap } from "@/engine/temporal/parser";
import type { TemporalMap } from "@/engine/temporal/types";

// ---------------------------------------------------------------------------
// VFS types
// ---------------------------------------------------------------------------

export interface VFSFile {
  activeCode: string;
  draftCode: string | null;
  compilationStatus: "idle" | "compiling" | "success" | "error";
  compilationError: string | null;
}

// ---------------------------------------------------------------------------
// vfsSlice
// ---------------------------------------------------------------------------

interface VFSSlice {
  files: Map<string, VFSFile>;
  activeFilePath: string | null;
  setActiveCode: (path: string, code: string) => void;
  setDraftCode: (path: string, code: string) => void;
  promoteDraft: (path: string) => void;
  discardDraft: (path: string) => void;
  setCompilationStatus: (
    path: string,
    status: VFSFile["compilationStatus"],
    error?: string
  ) => void;
  setActiveFile: (path: string) => void;
  createFile: (path: string, code: string) => void;
}

const createVFSSlice = (
  set: (fn: (state: StoreState) => Partial<StoreState>) => void
): VFSSlice => ({
  files: new Map(),
  activeFilePath: null,

  setActiveCode: (path, code) =>
    set((state) => {
      const existing = state.files.get(path);
      const updated = new Map(state.files);
      updated.set(path, {
        activeCode: code,
        draftCode: existing?.draftCode ?? null,
        compilationStatus: existing?.compilationStatus ?? "idle",
        compilationError: existing?.compilationError ?? null,
      });
      const newTemporalMap = parseTemporalMap(code);
      const selectedStillExists =
        state.selectedElementId !== null &&
        newTemporalMap !== null &&
        newTemporalMap.nodes.has(state.selectedElementId);
      return {
        files: updated,
        temporalMap: newTemporalMap,
        selectedElementId: selectedStillExists ? state.selectedElementId : null,
        selectedFrame: selectedStillExists ? state.selectedFrame : null,
      };
    }),

  setDraftCode: (path, code) =>
    set((state) => {
      const existing = state.files.get(path);
      const updated = new Map(state.files);
      updated.set(path, {
        activeCode: existing?.activeCode ?? "",
        draftCode: code,
        compilationStatus: "idle",
        compilationError: null,
      });
      return { files: updated };
    }),

  promoteDraft: (path) =>
    set((state) => {
      const file = state.files.get(path);
      if (!file || file.draftCode === null) return {};
      const updated = new Map(state.files);
      const newActiveCode = file.draftCode;
      updated.set(path, {
        activeCode: newActiveCode,
        draftCode: null,
        compilationStatus: file.compilationStatus,
        compilationError: file.compilationError,
      });
      const newTemporalMap = parseTemporalMap(newActiveCode);
      const selectedStillExists =
        state.selectedElementId !== null &&
        newTemporalMap !== null &&
        newTemporalMap.nodes.has(state.selectedElementId);
      return {
        files: updated,
        temporalMap: newTemporalMap,
        selectedElementId: selectedStillExists ? state.selectedElementId : null,
        selectedFrame: selectedStillExists ? state.selectedFrame : null,
      };
    }),

  discardDraft: (path) =>
    set((state) => {
      const file = state.files.get(path);
      if (!file) return {};
      const updated = new Map(state.files);
      updated.set(path, {
        ...file,
        draftCode: null,
        compilationStatus: "idle",
        compilationError: null,
      });
      return { files: updated };
    }),

  setCompilationStatus: (path, status, error) =>
    set((state) => {
      const file = state.files.get(path);
      if (!file) return {};
      const updated = new Map(state.files);
      updated.set(path, {
        ...file,
        compilationStatus: status,
        compilationError: error ?? null,
      });
      return { files: updated };
    }),

  setActiveFile: (path) => set(() => ({ activeFilePath: path })),

  createFile: (path, code) =>
    set((state) => {
      if (state.files.has(path)) return {};
      const updated = new Map(state.files);
      updated.set(path, {
        activeCode: code,
        draftCode: null,
        compilationStatus: "idle",
        compilationError: null,
      });
      return { files: updated };
    }),
});

// ---------------------------------------------------------------------------
// temporalSlice
// ---------------------------------------------------------------------------

interface TemporalSlice {
  temporalMap: TemporalMap | null;
  rebuildTemporalMap: (sourceCode: string) => void;
}

const createTemporalSlice = (
  set: (fn: (state: StoreState) => Partial<StoreState>) => void
): TemporalSlice => ({
  temporalMap: null,

  rebuildTemporalMap: (sourceCode) =>
    set(() => ({ temporalMap: parseTemporalMap(sourceCode) })),
});

// ---------------------------------------------------------------------------
// playerSlice
// ---------------------------------------------------------------------------

interface PlayerSlice {
  isPlaying: boolean;
  currentFrame: number;
  durationInFrames: number;
  fps: number;
  setPlaying: (playing: boolean) => void;
  setCurrentFrame: (frame: number) => void;
  setCompositionMeta: (duration: number, fps: number) => void;
}

const createPlayerSlice = (
  set: (fn: (state: StoreState) => Partial<StoreState>) => void
): PlayerSlice => ({
  isPlaying: false,
  currentFrame: 0,
  durationInFrames: 150,
  fps: 30,

  setPlaying: (playing) => set(() => ({ isPlaying: playing })),
  setCurrentFrame: (frame) => set(() => ({ currentFrame: frame })),
  setCompositionMeta: (duration, fps) =>
    set(() => ({ durationInFrames: duration, fps })),
});

// ---------------------------------------------------------------------------
// settingsSlice
// ---------------------------------------------------------------------------

interface SettingsSlice {
  apiKey: string | null;
  modelPreference: "sonnet" | "opus";
  theme: "dark";
  setApiKey: (key: string | null) => void;
  setModelPreference: (model: "sonnet" | "opus") => void;
}

const createSettingsSlice = (
  set: (fn: (state: StoreState) => Partial<StoreState>) => void
): SettingsSlice => ({
  apiKey: null,
  modelPreference: "sonnet",
  theme: "dark",

  setApiKey: (key) => set(() => ({ apiKey: key })),
  setModelPreference: (model) => set(() => ({ modelPreference: model })),
});

// ---------------------------------------------------------------------------
// selectionSlice
// ---------------------------------------------------------------------------

interface SelectionSlice {
  selectedElementId: string | null;
  selectedFrame: number | null;
  editMode: boolean;
  setSelection: (elementId: string, frame: number) => void;
  clearSelection: () => void;
  toggleEditMode: () => void;
  setEditMode: (editMode: boolean) => void;
}

const createSelectionSlice = (
  set: (fn: (state: StoreState) => Partial<StoreState>) => void
): SelectionSlice => ({
  selectedElementId: null,
  selectedFrame: null,
  editMode: false,

  setSelection: (elementId, frame) =>
    set(() => ({ selectedElementId: elementId, selectedFrame: frame })),

  clearSelection: () =>
    set(() => ({ selectedElementId: null, selectedFrame: null })),

  toggleEditMode: () =>
    set((state) => ({
      editMode: !state.editMode,
      isPlaying: state.editMode ? state.isPlaying : false,
    })),

  setEditMode: (editMode) =>
    set((state) => ({
      editMode,
      isPlaying: editMode ? false : state.isPlaying,
    })),
});

// ---------------------------------------------------------------------------
// uiSlice
// ---------------------------------------------------------------------------

interface UISlice {
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  versionHistoryOpen: boolean;
  openVersionHistory: () => void;
  closeVersionHistory: () => void;
  toggleVersionHistory: () => void;
  generateChatOpen: boolean;
  openGenerateChat: () => void;
  closeGenerateChat: () => void;
  toggleGenerateChat: () => void;
  fileTreeVisible: boolean;
  propertiesPanelVisible: boolean;
  timelineVisible: boolean;
  toggleFileTree: () => void;
  togglePropertiesPanel: () => void;
  toggleTimeline: () => void;
}

const createUISlice = (
  set: (fn: (state: StoreState) => Partial<StoreState>) => void
): UISlice => ({
  commandPaletteOpen: false,
  openCommandPalette: () => set(() => ({ commandPaletteOpen: true })),
  closeCommandPalette: () => set(() => ({ commandPaletteOpen: false })),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  versionHistoryOpen: false,
  openVersionHistory: () => set(() => ({ versionHistoryOpen: true })),
  closeVersionHistory: () => set(() => ({ versionHistoryOpen: false })),
  toggleVersionHistory: () =>
    set((state) => ({ versionHistoryOpen: !state.versionHistoryOpen })),
  generateChatOpen: false,
  openGenerateChat: () => set(() => ({ generateChatOpen: true })),
  closeGenerateChat: () => set(() => ({ generateChatOpen: false })),
  toggleGenerateChat: () =>
    set((state) => ({ generateChatOpen: !state.generateChatOpen })),
  fileTreeVisible: true,
  propertiesPanelVisible: true,
  timelineVisible: true,
  toggleFileTree: () =>
    set((state) => ({ fileTreeVisible: !state.fileTreeVisible })),
  togglePropertiesPanel: () =>
    set((state) => ({ propertiesPanelVisible: !state.propertiesPanelVisible })),
  toggleTimeline: () =>
    set((state) => ({ timelineVisible: !state.timelineVisible })),
});

// ---------------------------------------------------------------------------
// historySlice
// ---------------------------------------------------------------------------

export interface HistorySnapshot {
  id: string;
  timestamp: number;
  description: string;
  vfsState: Map<string, VFSFile>;
}

const MAX_SNAPSHOTS = 50;

interface HistorySlice {
  snapshots: HistorySnapshot[];
  currentSnapshotIndex: number;
  pushSnapshot: (description: string) => void;
  restoreSnapshot: (id: string) => void;
  undo: () => void;
}

const createHistorySlice = (
  set: (fn: (state: StoreState) => Partial<StoreState>) => void
): HistorySlice => ({
  snapshots: [],
  currentSnapshotIndex: -1,

  pushSnapshot: (description) =>
    set((state) => {
      const next: HistorySnapshot = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now(),
        description,
        vfsState: new Map(state.files),
      };
      const trimmed = [...state.snapshots, next].slice(-MAX_SNAPSHOTS);
      return {
        snapshots: trimmed,
        currentSnapshotIndex: trimmed.length - 1,
      };
    }),

  restoreSnapshot: (id) =>
    set((state) => {
      const index = state.snapshots.findIndex((s) => s.id === id);
      if (index === -1) return {};
      const snapshot = state.snapshots[index];
      const restoredFiles = new Map(snapshot.vfsState);
      const activeFile = state.activeFilePath
        ? restoredFiles.get(state.activeFilePath)
        : [...restoredFiles.values()][0];
      const newTemporalMap = activeFile
        ? parseTemporalMap(activeFile.activeCode)
        : null;
      return {
        files: restoredFiles,
        temporalMap: newTemporalMap,
        currentSnapshotIndex: index,
        selectedElementId: null,
        selectedFrame: null,
      };
    }),

  undo: () =>
    set((state) => {
      if (state.currentSnapshotIndex < 0) return {};
      const snapshot = state.snapshots[state.currentSnapshotIndex];
      if (!snapshot) return {};
      const restoredFiles = new Map(snapshot.vfsState);
      const activeFile = state.activeFilePath
        ? restoredFiles.get(state.activeFilePath)
        : [...restoredFiles.values()][0];
      const newTemporalMap = activeFile
        ? parseTemporalMap(activeFile.activeCode)
        : null;
      return {
        files: restoredFiles,
        temporalMap: newTemporalMap,
        currentSnapshotIndex: state.currentSnapshotIndex - 1,
        selectedElementId: null,
        selectedFrame: null,
      };
    }),
});

// ---------------------------------------------------------------------------
// Combined store type
// ---------------------------------------------------------------------------

type StoreState = VFSSlice &
  TemporalSlice &
  PlayerSlice &
  SettingsSlice &
  SelectionSlice &
  HistorySlice &
  UISlice;

// ---------------------------------------------------------------------------
// Persisted settings keys
// ---------------------------------------------------------------------------

interface PersistedSettings {
  apiKey: string | null;
  modelPreference: "sonnet" | "opus";
}

// ---------------------------------------------------------------------------
// Store factory — settings slice persisted to localStorage
// ---------------------------------------------------------------------------

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      ...createVFSSlice(set as Parameters<typeof createVFSSlice>[0]),
      ...createTemporalSlice(set as Parameters<typeof createTemporalSlice>[0]),
      ...createPlayerSlice(set as Parameters<typeof createPlayerSlice>[0]),
      ...createSettingsSlice(set as Parameters<typeof createSettingsSlice>[0]),
      ...createSelectionSlice(set as Parameters<typeof createSelectionSlice>[0]),
      ...createHistorySlice(set as Parameters<typeof createHistorySlice>[0]),
      ...createUISlice(set as Parameters<typeof createUISlice>[0]),
    }),
    {
      name: "motionlm-settings",
      storage: createJSONStorage(() => localStorage),
      // Only persist settings fields — VFS and player state is ephemeral
      partialize: (state): PersistedSettings => ({
        apiKey: state.apiKey,
        modelPreference: state.modelPreference,
      }),
    }
  )
);
