# Plan: IndexedDB Auto-Save + File System Access API

## Context

MotionLM loses all VFS files and history on browser refresh because only `apiKey` and `modelPreference` are persisted (localStorage via Zustand `persist`). This makes it unusable as a real editor. The fix is two layers:

1. **IndexedDB auto-save** — silently persists VFS + history to IndexedDB on every change. Restores on page load.
2. **File System Access API** — lets the user open `.tsx` files from disk (with a handle) and save back to the same location via Cmd+S, like a real desktop editor.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/persistence/idb.ts` | IndexedDB database, serialize/deserialize, debounced write subscription, restore |
| `src/persistence/filesystem.ts` | `openFileFromDisk()` and `saveFileToDisk()` using File System Access API with FileReader/download fallback |

## Files to Modify

| File | Change |
|---|---|
| `package.json` | Add `idb` dependency |
| `src/store.ts` | Add `hydrated` + `setHydrated` to uiSlice, add `fileHandles` Map + `setFileHandle` + `clearFileHandle` to vfsSlice |
| `src/App.tsx` | Hydration gate: show "Loading project..." until IDB restore completes, then render EditorLayout |
| `src/editor/layout/PreviewPanel.tsx` | Guard sample loading: skip if VFS already has files (one-line `if (files.size > 0) return;`) |
| `src/editor/layout/FileTreePanel.tsx` | Replace upload button to use FSAA `showOpenFilePicker` (with FileReader fallback), add Save button |
| `src/editor/layout/EditorLayout.tsx` | Add Cmd+S keyboard shortcut calling `saveFileToDisk` |

---

## Implementation Steps

### Step 1: Install `idb`

```bash
npm install idb
```

No `@types/wicg-file-system-access` needed — we'll declare a minimal ambient type in `src/persistence/filesystem.ts` to avoid a dev dependency for 5 type signatures.

### Step 2: Extend `src/store.ts`

**uiSlice** — add:
- `hydrated: boolean` (default `false`)
- `setHydrated: (v: boolean) => void`

**vfsSlice** — add:
- `fileHandles: Map<string, FileSystemFileHandle>` (session-only, NOT persisted to IDB)
- `setFileHandle: (path: string, handle: FileSystemFileHandle) => void`
- `clearFileHandle: (path: string) => void`

Keep existing `persist` middleware for settings unchanged — it operates on disjoint fields.

### Step 3: Create `src/persistence/idb.ts`

**Database:** name `"motionlm"`, version 1, three object stores: `vfs`, `history`, `meta` (all singleton-keyed).

**Serialization:**
- Define `PersistedVFSFile` with only `activeCode` and `draftCode` — strip `compilationStatus` and `compilationError` (they're transient runtime state).
- `Map<string, VFSFile>` serializes to `Array<[string, PersistedVFSFile]>`.
- History snapshots: cap at 20 in IDB (vs 50 in memory). Each snapshot's `vfsState` Map gets the same serialization.

**Key exports:**
- `restoreFromIDB()` — reads all stores, returns `{ files, snapshots, currentSnapshotIndex, activeFilePath } | null`
- `subscribeToStore()` — subscribes to Zustand store, debounces writes (500ms via `setTimeout`/`clearTimeout`), writes on `files`, `snapshots`, or `activeFilePath` reference changes

**Debounce pattern:** track previous `files`, `snapshots`, `activeFilePath` references. Skip if all three are unchanged (VFS actions always create new Maps, so reference equality works).

### Step 4: Update `src/App.tsx`

```tsx
export const App = () => {
  const hydrated = useStore((s) => s.hydrated);

  useEffect(() => {
    const hydrate = async () => {
      const restored = await restoreFromIDB();
      if (restored) {
        useStore.setState({ files: restored.files, snapshots: restored.snapshots,
          currentSnapshotIndex: restored.currentSnapshotIndex, activeFilePath: restored.activeFilePath });
      }
      useStore.getState().setHydrated(true);
      subscribeToStore(); // start auto-save AFTER hydration to avoid write-back of initial state
    };
    hydrate();
  }, []);

  if (!hydrated) return <div className="...">Loading project...</div>;
  return <EditorLayout />;
};
```

### Step 5: Guard sample loading in `src/editor/layout/PreviewPanel.tsx`

Line 61, add before `setActiveCode`:
```tsx
const { files } = useStore.getState();
if (files.size > 0) return; // VFS restored from IDB, skip sample
```

### Step 6: Create `src/persistence/filesystem.ts`

Two functions:

**`openFileFromDisk()`** — calls `showOpenFilePicker()` if available, reads file, calls `createFile` + `setActiveFile` + `setFileHandle`. Falls back to returning an error string directing user to the upload button.

**`saveFileToDisk(path)`** — if a handle exists for this path, writes directly (no dialog). If no handle, calls `showSaveFilePicker()` to get one, stores it, writes. Falls back to Blob + anchor download.

Both return `{ ok: true } | { ok: false; error: string }`.

Declare `FileSystemFileHandle` and `FileSystemWritableFileStream` as ambient types at the top of this file to avoid a types package dependency.

### Step 7: Update `FileTreePanel.tsx`

- Import `Save` from lucide-react, import `openFileFromDisk`, `saveFileToDisk` from `@/persistence/filesystem`
- Upload button: call `openFileFromDisk()` if FSAA supported, else fall back to existing `fileInputRef.current?.click()`
- Add a Save button (disk icon) next to Upload in the bottom toolbar, calls `saveFileToDisk(activeFilePath)`
- Keep the hidden `<input type="file">` as fallback

### Step 8: Add Cmd+S to `EditorLayout.tsx`

Insert before the existing Cmd+K handler (line 54):
```tsx
if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
  e.preventDefault();
  const { activeFilePath } = useStore.getState();
  if (activeFilePath) saveFileToDisk(activeFilePath);
  return;
}
```

---

## Build Order

Steps 1-5 = Layer 1 (IndexedDB). Self-contained and testable independently.
Steps 6-8 = Layer 2 (File System Access). Builds on top of Layer 1.

---

## Verification

### Layer 1 — IndexedDB
1. `npm run dev` — app loads, sample file appears (first visit, IDB empty)
2. Edit code via command palette or generate chat
3. DevTools > Application > IndexedDB > "motionlm" — verify `vfs`, `history`, `meta` stores have data
4. Refresh the page — VFS restores with edited code, not the sample. Preview renders correctly.
5. Create a second file in the file tree, refresh — both files persist
6. Make 3 edits to push history snapshots, refresh — history panel shows restored snapshots
7. `npm run typecheck` — zero errors

### Layer 2 — File System Access (Chrome/Edge)
1. Click Upload/Open — native file picker opens
2. Select a `.tsx` file — it appears in file tree, compiles, previews
3. Edit the file via command palette
4. Press Cmd+S — file saves to disk silently (no dialog, same handle)
5. Open the saved file in another editor — verify edits are there
6. Press Cmd+S on a file created via "New File" (no handle) — "Save As" dialog appears
7. Test in Firefox — Upload falls back to FileReader, Save falls back to download
8. `npm run typecheck` — zero errors
