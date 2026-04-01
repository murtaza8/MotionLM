import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";

import { parseTemporalMap } from "@/engine/temporal/parser";
import { useStore } from "@/store";
import type { VFSFile, HistorySnapshot } from "@/store";
import type { AgentMessage } from "@/agent/types";

const DB_NAME = "motionlm";
const DB_VERSION = 2;
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

// ---------------------------------------------------------------------------
// Conversation and edit journal types
// ---------------------------------------------------------------------------

interface ConversationRecord {
  sessionId: string;
  messages: AgentMessage[];
  preview: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface EditJournalEntry {
  editId: number;
  sessionId: string;
  instruction: string;
  elementTargeted: string | null;
  filePath: string;
  wasAccepted: boolean;
  compilationAttempts: number;
  errorTypes: string[];
  timestamp: number;
}

// Internal type for the IDB value (editId is auto-increment, optional on insert)
type EditJournalValue = Omit<EditJournalEntry, "editId"> & { editId?: number };

// ---------------------------------------------------------------------------
// DB schema
// ---------------------------------------------------------------------------

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
  conversations: {
    key: string;
    value: ConversationRecord;
    indexes: { by_lastActive: number };
  };
  editJournal: {
    key: number;
    value: EditJournalValue;
    indexes: { by_element: string };
  };
}

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBPDatabase<MotionLMSchema>> | null = null;

const IDB_TIMEOUT_MS = 5_000;

const getDB = (): Promise<IDBPDatabase<MotionLMSchema>> => {
  if (!dbPromise) {
    const openPromise = openDB<MotionLMSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("vfs");
          db.createObjectStore("history");
          db.createObjectStore("meta");
        }
        if (oldVersion < 2) {
          const conversationsStore = db.createObjectStore("conversations", {
            keyPath: "sessionId",
          });
          conversationsStore.createIndex("by_lastActive", "lastActiveAt");

          const journalStore = db.createObjectStore("editJournal", {
            keyPath: "editId",
            autoIncrement: true,
          });
          journalStore.createIndex("by_element", "elementTargeted");
        }
      },
      blocked() {
        // A stale connection is blocking the v1→v2 upgrade.
        // Reload to close it; the upgrade will proceed on the next load.
        window.location.reload();
      },
      blocking(_currentVersion, _newVersion, event) {
        // This connection is blocking a newer version — close it immediately.
        (event.target as IDBDatabase).close();
      },
    });

    // Safety net: if openDB never resolves (e.g. blocked with no handler firing),
    // reject after IDB_TIMEOUT_MS so hydration can proceed without persistence.
    // Cancel the timer when the DB opens successfully so it cannot null dbPromise
    // after the connection is already established.
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        dbPromise = null; // allow retry on next call
        reject(new Error("IDB open timed out"));
      }, IDB_TIMEOUT_MS);
    });

    dbPromise = Promise.race([
      openPromise.then((db) => { clearTimeout(timeoutId); return db; }),
      timeout,
    ]) as Promise<IDBPDatabase<MotionLMSchema>>;
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
// Preview extractor (module-private helper)
// ---------------------------------------------------------------------------

const extractPreview = (messages: AgentMessage[]): string => {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    for (const block of msg.content) {
      if (block.type === "text" && block.text.trim().length > 0) {
        return block.text.trim().slice(0, 80);
      }
    }
  }
  return "New session";
};

// ---------------------------------------------------------------------------
// Public API — VFS + history
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
  // Sticky flags: set to true on change, reset to false only after the write
  // fires. This prevents a conversation update from being silently dropped when
  // a VFS change follows it within the debounce window and overwrites the flags.
  let pendingVFS = false;
  let pendingConversation = false;

  const unsubscribe = useStore.subscribe((state, prevState) => {
    if (
      state.files !== prevState.files ||
      state.snapshots !== prevState.snapshots ||
      state.activeFilePath !== prevState.activeFilePath
    ) {
      pendingVFS = true;
    }

    if (
      state.conversationHistory !== prevState.conversationHistory &&
      state.activeSessionId !== null &&
      state.conversationHistory.length > 0
    ) {
      pendingConversation = true;
    }

    if (!pendingVFS && !pendingConversation) return;

    // Always use the store's current state when the timer fires, not the
    // state captured at subscription time, so we get the latest values.
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const s = useStore.getState();
      if (pendingVFS) {
        pendingVFS = false;
        void writeToIDB(s.files, s.snapshots, s.currentSnapshotIndex, s.activeFilePath);
      }
      if (pendingConversation && s.activeSessionId !== null) {
        pendingConversation = false;
        void saveConversation(
          s.activeSessionId,
          s.conversationHistory,
          extractPreview(s.conversationHistory)
        );
      }
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

// ---------------------------------------------------------------------------
// Public API — conversations
// ---------------------------------------------------------------------------

/**
 * Upsert a conversation record, updating lastActiveAt to now.
 */
export const saveConversation = async (
  sessionId: string,
  messages: AgentMessage[],
  preview: string
): Promise<void> => {
  try {
    const db = await getDB();
    const existing = await db.get("conversations", sessionId);
    const now = Date.now();
    await db.put("conversations", {
      sessionId,
      messages,
      preview,
      createdAt: existing?.createdAt ?? now,
      lastActiveAt: now,
    });
  } catch {
    // Best-effort
  }
};

/**
 * Load messages for a given session. Returns null if not found.
 */
export const loadConversation = async (
  sessionId: string
): Promise<AgentMessage[] | null> => {
  try {
    const db = await getDB();
    const record = await db.get("conversations", sessionId);
    return record?.messages ?? null;
  } catch {
    return null;
  }
};

/**
 * List all conversations sorted by lastActiveAt descending.
 */
export const listConversations = async (): Promise<
  Array<{
    sessionId: string;
    preview: string;
    createdAt: number;
    lastActiveAt: number;
    messageCount: number;
  }>
> => {
  try {
    const db = await getDB();
    const all = await db.getAllFromIndex(
      "conversations",
      "by_lastActive"
    );
    // getAllFromIndex returns ascending order; reverse for descending
    return all
      .reverse()
      .map((r) => ({
        sessionId: r.sessionId,
        preview: r.preview,
        createdAt: r.createdAt,
        lastActiveAt: r.lastActiveAt,
        messageCount: r.messages.length,
      }));
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Public API — edit journal
// ---------------------------------------------------------------------------

/**
 * Append a new edit journal entry (editId is auto-assigned).
 */
export const appendEditJournalEntry = async (
  entry: Omit<EditJournalEntry, "editId">
): Promise<void> => {
  try {
    const db = await getDB();
    await db.add("editJournal", entry as EditJournalValue);
  } catch {
    // Best-effort
  }
};

/**
 * Get recent journal entries, optionally filtered by elementTargeted.
 * Sorted by timestamp descending.
 */
export const getRecentJournalEntries = async (
  limit: number,
  elementTargeted?: string
): Promise<EditJournalEntry[]> => {
  try {
    const db = await getDB();
    let entries: EditJournalValue[];

    if (elementTargeted !== undefined) {
      entries = await db.getAllFromIndex(
        "editJournal",
        "by_element",
        elementTargeted
      );
    } else {
      entries = await db.getAll("editJournal");
    }

    return entries
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit) as EditJournalEntry[];
  } catch {
    return [];
  }
};
