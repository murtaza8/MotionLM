import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";

import { parseTemporalMap } from "@/engine/temporal/parser";
import { useStore } from "@/store";
import type { VFSFile, HistorySnapshot } from "@/store";

const DB_NAME = "motionlm";
const DB_VERSION = 1;
const MAX_IDB_SNAPSHOTS = 20;
const DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Serialization types — transient runtime state stripped
// ---------------------------------------------------------------------------

interface PersistedVFSFile {
  activeCode: string;
  draftCode: string | null;
}

interface PersistedSnapshot {
  id: string;
  timestamp: number;
  description: string;
  vfsState: Array<[string, PersistedVFSFile]>;
}

interface MotionLMSchema extends DBSchema {
  vfs: {
    key: string;
    value: Array<[string, PersistedVFSFile]>;
  };
  history: {
    key: string;
    value: { snapshots: PersistedSnapshot[]; currentSnapshotIndex: number };
  };
  meta: {
    key: string;
    value: string | null;
  };
}

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBPDatabase<MotionLMSchema>> | null = null;

const getDB = (): Promise<IDBPDatabase<MotionLMSchema>> => {
  if (!dbPromise) {
    dbPromise = openDB<MotionLMSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("vfs")) db.createObjectStore("vfs");
        if (!db.objectStoreNames.contains("history")) db.createObjectStore("history");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      },
    });
  }
  return dbPromise;
};

// ---------------------------------------------------------------------------
// Serialize / deserialize
// ---------------------------------------------------------------------------

const serializeVFS = (
  files: Map<string, VFSFile>
): Array<[string, PersistedVFSFile]> =>
  Array.from(files.entries()).map(([path, file]) => [
    path,
    { activeCode: file.activeCode, draftCode: file.draftCode },
  ]);

const deserializeVFS = (
  entries: Array<[string, PersistedVFSFile]>
): Map<string, VFSFile> => {
  const map = new Map<string, VFSFile>();
  for (const [path, file] of entries) {
    map.set(path, {
      activeCode: file.activeCode,
      draftCode: file.draftCode,
      compilationStatus: "idle",
      compilationError: null,
    });
  }
  return map;
};

const serializeSnapshots = (snapshots: HistorySnapshot[]): PersistedSnapshot[] =>
  snapshots.map((s) => ({
    id: s.id,
    timestamp: s.timestamp,
    description: s.description,
    vfsState: serializeVFS(s.vfsState),
  }));

const deserializeSnapshots = (
  snapshots: PersistedSnapshot[]
): HistorySnapshot[] =>
  snapshots.map((s) => ({
    id: s.id,
    timestamp: s.timestamp,
    description: s.description,
    vfsState: deserializeVFS(s.vfsState),
  }));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RestoredState {
  files: Map<string, VFSFile>;
  snapshots: HistorySnapshot[];
  currentSnapshotIndex: number;
  activeFilePath: string | null;
}

/**
 * Restore VFS + history from IndexedDB.
 * Returns null on first visit or if IDB is unavailable.
 */
export const restoreFromIDB = async (): Promise<RestoredState | null> => {
  try {
    const db = await getDB();
    const [vfsRaw, historyRaw, activeFilePath] = await Promise.all([
      db.get("vfs", "current"),
      db.get("history", "current"),
      db.get("meta", "activeFilePath"),
    ]);

    if (!vfsRaw || vfsRaw.length === 0) return null;

    const files = deserializeVFS(vfsRaw);
    const snapshots = historyRaw ? deserializeSnapshots(historyRaw.snapshots) : [];
    const currentSnapshotIndex = historyRaw?.currentSnapshotIndex ?? -1;

    return {
      files,
      snapshots,
      currentSnapshotIndex,
      activeFilePath: activeFilePath ?? null,
    };
  } catch {
    // IDB unavailable or data corrupted — treat as fresh start
    return null;
  }
};

const writeToIDB = async (
  files: Map<string, VFSFile>,
  snapshots: HistorySnapshot[],
  currentSnapshotIndex: number,
  activeFilePath: string | null
): Promise<void> => {
  try {
    const db = await getDB();
    const capped = snapshots.slice(-MAX_IDB_SNAPSHOTS);
    const cappedIndex = Math.min(currentSnapshotIndex, capped.length - 1);
    await Promise.all([
      db.put("vfs", serializeVFS(files), "current"),
      db.put(
        "history",
        { snapshots: serializeSnapshots(capped), currentSnapshotIndex: cappedIndex },
        "current"
      ),
      db.put("meta", activeFilePath, "activeFilePath"),
    ]);
  } catch {
    // Best-effort — silently ignore write failures
  }
};

/**
 * Subscribe to the Zustand store and auto-save to IDB on changes.
 * Must be called after hydration to avoid writing the initial empty state back.
 * Returns an unsubscribe function.
 */
export const subscribeToStore = (): (() => void) => {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = useStore.subscribe((state, prevState) => {
    if (
      state.files === prevState.files &&
      state.snapshots === prevState.snapshots &&
      state.activeFilePath === prevState.activeFilePath
    ) {
      return;
    }

    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void writeToIDB(
        state.files,
        state.snapshots,
        state.currentSnapshotIndex,
        state.activeFilePath
      );
    }, DEBOUNCE_MS);
  });

  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    unsubscribe();
  };
};

/**
 * Apply restored state to the store, including rebuilding the temporal map.
 */
export const applyRestoredState = (restored: RestoredState): void => {
  const activeFile = restored.activeFilePath
    ? restored.files.get(restored.activeFilePath)
    : [...restored.files.values()][0];

  const temporalMap = activeFile
    ? parseTemporalMap(activeFile.activeCode)
    : null;

  useStore.setState({
    files: restored.files,
    snapshots: restored.snapshots,
    currentSnapshotIndex: restored.currentSnapshotIndex,
    activeFilePath: restored.activeFilePath,
    temporalMap,
  });
};
