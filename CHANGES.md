# MotionLM — Ad-hoc Changes Log

This file tracks changes and additions made outside the formal PLAN.md task structure.
Read this at the start of every session alongside PLAN.md to get a complete picture of the current app state.

**Format per entry:**
- What now exists (not what was changed)
- Files affected
- Any architectural decisions or edge cases worth knowing

---

## Agent edits now create history snapshots (2026-04-01)

`edit_file` and `create_file` tools now call `store.pushSnapshot()` after every successful compilation and store commit. Previously, agent edits updated the preview but never appeared in the History panel ("No history yet" was shown even after a successful edit).

- Files: `src/agent/tools/edit-file.ts`, `src/agent/tools/create-file.ts`
- `edit-file.ts`: calls `store.pushSnapshot(\`Agent edited ${path}\`)` after `setActiveCode` / `createFile`
- `create-file.ts`: calls `store.pushSnapshot(\`Agent created ${path}\`)` after `createFile`

---

## ContextPill shows source line number (2026-03-31)

`ContextPill` in the agent chat input now displays `@div:148` (the element's source line number from `selectedElementId`) instead of `@div:0` (which was incorrectly appending the current playback frame). The `selectedElementId` already encodes `tagName:lineNumber`, so the pill now renders it directly.

- Files: `src/editor/chat/ContextPill.tsx`
- Removed unused `selectedFrame` read from store in this component

---

## Phase A bug fixes (2026-03-31)

Post-review fixes for Phase A agent implementation. Four bugs corrected:

1. **`AgentAction.tool_call_result` now includes `toolName`** — allows session.ts to distinguish think calls from real edits without a separate lookup. Added `assistant_turn` action that carries the complete assistant content blocks (text + tool_use) for persistent history storage.
   - Files: `src/agent/types.ts`

2. **Runner emits `assistant_turn` action** — after building each API turn's assistant content, runner now yields `{ type: "assistant_turn", content }` before executing tools. Session.ts catches this to append the full message (text + tool_use blocks) to conversation history. Previously only streamed text was stored, causing multi-turn context loss.
   - Files: `src/agent/runner.ts`

3. **Session.ts stores complete assistant messages** — handles `assistant_turn` action to append full content to store. Only calls `recordEdit()` for non-think tools (think calls are zero-cost, shouldn't advance the profile cache invalidation counter). Removed dead `toolResultSummaries` accumulator.
   - Files: `src/agent/session.ts`

4. **`create_file` tool validates compilation** — now calls `compileWithVFS()` before creating the file, consistent with `edit_file`. Returns compilation error if code is invalid instead of silently creating a broken file.
   - Files: `src/agent/tools/create-file.ts`

---

## 2026-03-31 — Agentic transformation: plan and branch

MotionLM is transitioning from a tool-with-AI-features to a truly agentic AI collaborator. This is a major architectural shift.

**What changed:**
- Previous PLAN.md (phases 0-5, all completed) archived to `Plans/phase-0-5-plan.md`
- New PLAN.md created with agentic transformation tasks (Phase A through Phase F)
- Full architecture rationale in `Plans/agentic-transformation-plan.md`
- Development moves to `agentic-v2` branch; `main` stays stable

**Architectural direction:**
- Single agent loop using Anthropic's native tool_use API replaces both CommandPalette (single-turn edits) and GenerateChat (multi-turn generation)
- New `src/agent/` directory: runner, session, tools, context builder, cache manager, memory, proactive intelligence
- New `agentSlice` in Zustand store for agent state, conversation history, token tracking
- Prompt caching with `cache_control` breakpoints for 90% cost reduction on cached context
- `think` tool for internal agent reasoning (viewable by user on click)
- Feature-flagged AgentChat panel runs alongside existing UI during transition
- Old CommandPalette and GenerateChat removed only in Phase E after validation
- Visual grounding via Remotion's `renderStill()` (not html-to-image)
- Web Worker for Babel compilation in Phase B
- Memory layer (session persistence, style profile, edit journal) in Phase C
- Proactive suggestions with timeline ghost tracks in Phase D
- Director inputs (spatial draw-to-animate, voice-to-action) in Phase E

Files affected: `PLAN.md`, `Plans/phase-0-5-plan.md` (new), `Plans/agentic-transformation-plan.md` (new)

---

## 2026-03-31 — MP4 export UI

`ExportModal` (`src/editor/export/ExportModal.tsx`) wires the existing render server to the UI. An "Export" button in the toolbar opens a Radix Dialog that:
1. Shows composition metadata (format, resolution, duration) and a Render button.
2. Posts to `POST /api/render`, then subscribes to the SSE progress stream (`/api/render/:id/progress`) and shows a progress bar.
3. On completion shows a "Download MP4" anchor pointing at `/api/render/:id/download` — the browser native file-save dialog handles the download without any fetch/blob gymnastics.
4. Handles cancellation (closes EventSource, resets to idle) and error states.

Modal state is local (`useState`) — not in the Zustand store — because render state is ephemeral and not needed across sessions. Only `exportModalOpen / openExportModal / closeExportModal` were added to `uiSlice` in `src/store.ts`.

Files affected: `src/editor/export/ExportModal.tsx` (new), `src/store.ts`, `src/editor/layout/EditorLayout.tsx`.

---

## How to add an entry

When you make a change that is not part of a PLAN.md task, append an entry here:

```
## [YYYY-MM-DD] Short title
- What exists now / how it works
- Files: path/to/file.tsx, path/to/other.ts
- Notes: any decisions, caveats, or known issues
```

---

<!-- Add new entries below this line, newest first -->

## 2026-04-01 — Phase C code review: four bugs fixed

**1. `getDB` timeout nulled `dbPromise` after a successful open** (`src/persistence/idb.ts`)
The 5-second safety-net timer called `dbPromise = null` unconditionally, even if `openDB` resolved in ~100ms. After 5 seconds, every `getDB()` call opened a new connection — silent connection leaks, potential version-change conflicts, and wasted IDB roundtrips. Fix: chain `.then((db) => { clearTimeout(timeoutId); return db; })` on `openPromise` so the timer is cancelled the moment the DB opens successfully.

**2. `subscribeToStore` dropped conversation saves when VFS changed in the same debounce window** (`src/persistence/idb.ts`)
`shouldSaveConversation` was a per-subscriber-call local. If a VFS state change followed a conversation change within 500ms, the new debounce timer captured `shouldSaveConversation = false`, silently discarding the conversation update — it was never written to IDB until the next standalone conversation change. Fix: replaced with outer-scope sticky flags (`pendingVFS`, `pendingConversation`) that are set to `true` on change and reset to `false` only after the actual write fires. The timer now reads fresh state from `useStore.getState()` at fire time rather than from the subscriber closure, so it always writes the latest values. As a bonus, `writeToIDB` is now skipped when only the conversation changed (no VFS write needed).

**3. React StrictMode double-subscription** (`src/App.tsx`)
`main.tsx` wraps the app in `<StrictMode>`, which double-invokes effects in development. `subscribeToStore()` was called inside the async `hydrate()` function with the return value discarded, so the `useEffect` cleanup had nothing to call. Each StrictMode cycle added a new subscription, doubling IDB writes with no way to clean up. Fix: moved `subscribeToStore()` to the synchronous part of the effect so its return value can be used as the `useEffect` cleanup function (`return unsubscribe`). Subscribing before hydration is safe — the subscriber only fires on reference changes, and `applyRestoredState` produces those by setting a new `files` Map.

**4. Session history switch didn't abort the running agent or reset state** (`src/editor/chat/AgentChat.tsx`)
`handleSessionClick` called `useStore.setState({ conversationHistory, activeSessionId })` without aborting the currently-running agent. If the agent was mid-execution, it continued appending messages to the newly restored conversation, contaminating it. `activeSession` was also left as the old instance, so the next send used `isFirstTurn = false` and the wrong `cacheState` for the restored session. Fix: `activeSession?.abort()` + `activeSession = null` before `setState`, and include `agentState: IDLE` and `pendingToolCalls: []` in the setState call so the UI transitions cleanly.

Files: `src/persistence/idb.ts`, `src/App.tsx`, `src/editor/chat/AgentChat.tsx`

## 2026-04-01 — Fix: restored conversation wiped on first send after page refresh

`AgentSession.create()` calls `resetSession()` which sets `conversationHistory = []`. When a conversation was restored from IDB during hydration, the first message the user sent would silently wipe it — the session resumed from scratch instead of continuing.

Fix: added `AgentSession.resume()` (src/agent/session.ts) — creates a session without calling `resetSession()`, sets `isFirstTurn = false` (so `buildFollowUpUserMessage` is used, appropriate for a continuing conversation), and only resets transient state (agentState, pendingToolCalls, iterationCount, thinkLog).

`getOrCreateSession()` in `AgentChat.tsx` now calls `resume()` when the store already has a non-empty `conversationHistory` with a valid `activeSessionId` (i.e. a conversation was restored from IDB), and `create()` otherwise.

Files: `src/agent/session.ts`, `src/editor/chat/AgentChat.tsx`

## 2026-04-01 — Hydration safety net: IDB timeout + try/finally

`hydrate()` in `App.tsx` could hang forever if `openDB` never resolved (blocked upgrade or corrupted state), leaving `hydrated = false` and the "Loading project..." screen up permanently. Two defensive changes:

- `getDB()` in `src/persistence/idb.ts`: races `openDB` against a 5-second timeout. If IDB doesn't open within 5s, the promise rejects, `dbPromise` is cleared (allowing a retry on the next call), and all callers' `try/catch` blocks return safe fallbacks (`null` / `[]`).
- `hydrate()` in `src/App.tsx`: wrapped in `try/finally` so `setHydrated(true)` + `subscribeToStore()` are guaranteed to fire even if an unexpected error escapes the individual IDB call handlers. Adds `console.error` for visibility.

Files: `src/persistence/idb.ts`, `src/App.tsx`

## 2026-04-01 — Fix slow/stuck initial load after Phase C

Two root causes, both fixed:

**Vite dep optimization loop** (`vite.config.ts`): `@radix-ui/react-popover` was in `package.json` but never imported in source code before Phase C. When Vite's dev server encounters a new dep import for the first time during a page load, it pre-bundles it and triggers a page reload. With several transitive deps (`@floating-ui/dom` etc.) this could loop long enough to appear hung. Added `optimizeDeps.include` for all Radix UI and floating-ui packages so they are pre-bundled at server startup instead.

**IDB v1→v2 upgrade blocked** (`src/persistence/idb.ts`): If a stale v1 connection is open (e.g. from a previous tab or Vite HMR module re-evaluation), the v2 `openDB` call hangs indefinitely — no reject, no resolve — which keeps `hydrated` false and the loading screen up forever. Added `blocked` callback (reloads the page, closing the stale connection) and `blocking` callback (closes this connection if a newer version tries to open).

Files: `vite.config.ts`, `src/persistence/idb.ts`

## 2026-04-01 — Phase C: Memory layer (conversation persistence + edit journal)

Session history and edit tracking are now persisted to IndexedDB.

**IDB schema v2** (`src/persistence/idb.ts`):
- `conversations` store (keyed by sessionId, indexed by lastActiveAt): stores full `AgentMessage[]` + preview text + timestamps. `saveConversation` upserts; `loadConversation` fetches by id; `listConversations` returns all sorted newest-first with message count.
- `editJournal` store (auto-increment key, indexed by elementTargeted): appended after every `edit_file` or `create_file` tool result. `appendEditJournalEntry` / `getRecentJournalEntries` are the public API.
- Upgrade handler is additive (`oldVersion < 1` creates original stores, `oldVersion < 2` creates new ones) — existing DBs upgrade without data loss.

**Auto-save** (`src/persistence/idb.ts — subscribeToStore`):
- The existing debounced subscriber now also watches `conversationHistory`. When it changes and `activeSessionId` is non-null, `saveConversation` is called in the same debounced callback as the VFS write (no second timer).
- `extractPreview` scans messages for the first non-empty user text block (max 80 chars) to populate the preview field.

**Hydration restore** (`src/App.tsx`):
- After `applyRestoredState`, the most recent conversation is loaded from IDB if it is under 24 hours old. `conversationHistory` and `activeSessionId` are applied in a single `setState` call before `setHydrated(true)` to prevent a race with `resetSession`.

**Edit journal writes** (`src/agent/session.ts`, `src/agent/runner.ts`, `src/agent/types.ts`):
- `tool_call_result` action now carries `input: Record<string, unknown>` (the parsed tool input). Runner hoists `toolInput` out of the `try` block so it is always in scope at the yield site.
- Session's `tool_call_result` handler appends an `EditJournalEntry` for `edit_file` and `create_file` calls — fire-and-forget, does not block the agent loop.

**Session history popover** (`src/editor/chat/AgentChat.tsx`):
- Clock icon button in the chat header opens a Radix Popover. Content loads lazily on open via `listConversations()`.
- Displays up to 20 sessions with relative date ("Today", "Yesterday", "Apr 1"), preview text, and message count.
- Clicking a row calls `loadConversation` and restores via `useStore.setState`; inline error shown if the record is missing.

**Out of scope for Phase C**: Style Extractor, User Profile store, System Prompt Injection — excluded due to complexity vs. value trade-off.

## 2026-03-31 — runner.ts: tighten toolResultContent type

`toolResultContent` was typed as `AgentRequestMessage["content"]` (the wide `AgentContentBlock[]` from client.ts) even though it only ever holds `tool_result` blocks. Changed to `ToolResultContentBlock[]` (from types.ts), which removes the `as unknown as` double cast at the `tool_result_turn` yield site. The `currentMessages.push` at the API boundary compiles without a cast because `ToolResultContentBlock` is structurally compatible with `AgentContentBlock`'s `tool_result` variant.

Files: `src/agent/runner.ts`

## 2026-03-31 — Fix capture_frame: renders wrong composition when VFS has multiple files

`capture_frame` and `capture_sequence` were sending all VFS files but no entry path. The server fell back to `/main.tsx` or the first file alphabetically, which meant any composition not named `main.tsx` (e.g. `billiard-shot.tsx`) would silently render the wrong composition.

Fix: pass `entryPath: store.activeFilePath` in both tools. Server `RenderStillSchema` and `RenderStillParams` now accept an optional `entryPath`. `handleRenderStill` uses it as `mainVfsKey` when provided, falling back to the old heuristic only when absent.

Files: `src/agent/tools/capture-frame.ts`, `src/agent/tools/capture-sequence.ts`, `server/render-server.ts`, `server/render-handler.ts`

## 2026-03-31 — Fix capture_frame: hardcoded ./main import path

`handleRenderStill` in `server/render-handler.ts` hardcoded `import from './main'` in the wrapper entry file regardless of the actual VFS file path. Files named anything other than `main.tsx` (e.g. `billiard-shot.tsx`) caused a webpack bundle error: `Can't resolve './main'`.

Fix: track the actual VFS key that provides the entry code, derive `mainRelative` (disk path) and `mainImportPath` (import-safe path without extension) from it. The `registerRoot` branch and the wrapper import both now use the correct path.

Files: `server/render-handler.ts`

## 2026-03-31 — Phase B Session 2: Tools integration + agent runner image support

### Image content block end-to-end flow (B.2.1)
- `src/agent/types.ts`: Added `tool_result_turn` action to `AgentAction`. Emitted after each batch of tool executions so conversation history stays complete. Contains `ToolResultContentBlock[]` (text or image).
- `src/agent/runner.ts`: Emits `tool_result_turn` with full tool result content before the loop-back `currentMessages.push`. This means session.ts can store the result message in the store, enabling `findToolResult` in MessageList to correctly pair tool_use blocks with their results.
- `src/agent/session.ts`: Handles `tool_result_turn` by calling `appendMessage({ role: "user", content })`. Previously tool result messages were only in the runner's local `currentMessages` array; they never reached `conversationHistory`. This caused ToolCallCards to always appear pending and images to never display.
- `src/editor/chat/ToolCallCard.tsx`: Added `Camera` / `Film` icons for `capture_frame` / `capture_sequence`. Added `extractOutputImage` helper that finds image blocks in tool_result content. Renders captured PNG inline in the expanded card. Added `summarizeInput` entries for both new tools.

### System prompt visual grounding (B.2.3)
- `src/ai/system-prompt.ts`: Added `<visual-grounding>` section to `buildAgentSystemPrompt` instructing the agent to call `capture_frame` after visual edits, when asked about appearance, and `capture_sequence` for timing reviews. Under 150 tokens. Added `capture_frame` and `capture_sequence` to the `<capabilities>` tool list.

### Compiler bridge timeout (B.2.4)
- `src/engine/compiler-bridge.ts`: Added `WORKER_TIMEOUT_MS = 10_000`. The pending-map entries now clear their own timeout on resolve/reject. If the worker hangs, the promise rejects after 10s and `compileAsync` falls back to synchronous `compileWithVFS`. This prevents the agent loop from blocking indefinitely on a stalled worker.

## 2026-03-31 — Phase B: Visual Grounding + Web Worker

### POST /api/render/still
- `server/render-handler.ts`: `handleRenderStill()` — bundles VFS to temp dir, calls `renderStill()` from `@remotion/renderer`, reads PNG output as base64, cleans up temp dir on completion or error. Defaults to 854×480.
- `server/render-server.ts`: `POST /api/render/still` route with zod validation (`RenderStillSchema`). Returns `{ ok: true, data: base64string }` or `{ ok: false, error }`.

### capture_frame and capture_sequence tools
- `src/agent/tools/capture-frame.ts`: Agent tool that calls `/api/render/still` with the current VFS and playhead frame. Returns `ToolResult { type: "image" }` on success, text error on failure or if render server is unreachable.
- `src/agent/tools/capture-sequence.ts`: Agent tool accepting `{ frames: number[] }` (max 4). Renders all frames in parallel, stitches into a 2×2 filmstrip via `OffscreenCanvas`. Falls back to first frame if OffscreenCanvas is unavailable.
- `src/agent/tools/index.ts`: Both tools exported and registered in `ALL_TOOLS`.

### Web Worker compilation
- `src/engine/compiler.worker.ts`: Dedicated worker that runs the Babel transform step (dep graph, topo sort, `Babel.transform()`) for all VFS files. Returns `{ transformedSources, compilationOrder }` — NOT React components (functions can't cross postMessage). Does not import from compiler.ts to avoid the `useStore` hoisted import; re-implements the ~80-line pure dep graph + transform logic using the babel plugins directly.
- `src/engine/compiler-bridge.ts`: Main-thread wrapper. `compileAsync(entryPath, files)` posts to the worker, receives transformed sources, then runs `new Function()` on the main thread to extract the React component. Pending-map pattern for request/response. Falls back to synchronous `compileWithVFS()` if the worker is unavailable (SSR, crash, older browser).
- `src/engine/compiler.ts`: Added exports for `extractTopLevelNames`, `resolveRootComponent`, `ROOT_WRAPPER_NAMES`, `API_PARAM_NAMES`, `API_PARAM_VALUES`, `REGISTRY_PARAM`, `humanizeRuntimeError` — used by the bridge for the `new Function()` execution step.
- `src/editor/layout/PreviewPanel.tsx`: Replaced synchronous `compileWithVFS()` call with `compileAsync()` from the bridge. Added stale-check to discard in-flight results when active file changes mid-compile.

## [2026-03-31] Settings panel + inline edit prompt in PropertiesPanel

**API key discoverability:**
- `src/editor/settings/SettingsPanel.tsx` (new): Radix Dialog with password input (show/hide toggle), model preference toggle (Sonnet/Opus), and Save/Cancel. Local state syncs from store on open — same pattern as old CommandPalette key input. Saved via `setApiKey` + `setModelPreference`.
- `src/editor/layout/EditorLayout.tsx`: Gear icon button added to toolbar (right of History). Shows an amber dot badge when no API key is set. `<SettingsPanel />` rendered at root. Slim amber banner inserted between toolbar and content row when `apiKey` is null — disappears automatically when key is saved, no dismiss needed.
- `src/store.ts`: UISlice gains `settingsPanelOpen`, `openSettingsPanel`, `closeSettingsPanel`.
- `src/editor/prompt/CommandPalette.tsx`: API key password input and all related local state removed. `setApiKey` no longer imported or called from here. Model preference toggle retained for quick access.

**Inline edit prompt:**
- `src/ai/useEditStream.ts` (new): Shared hook owning the full AI streaming flow — assembles context, streams via `sendEditRequest`, parses and applies edits. Returns `{ submit, cancel, isStreaming, error, clearError }`. `submit` returns `Promise<boolean>` (true = success) so callers can close/clear without stale-closure issues. Reads store values at call time via `useStore.getState()` to avoid stale closure on `files`/`selectedElementId` etc.
- `src/editor/layout/PropertiesPanel.tsx`: Inline textarea + Apply button added at the bottom (outside scroll area, `shrink-0`) when `selectedElementId !== null`. Auto-focuses on element selection (50ms delay). Enter submits, Shift+Enter inserts newline. Uses `useEditStream`. Stale "Open Cmd+K" hint text removed.
- `src/editor/prompt/CommandPalette.tsx`: Now uses `useEditStream` hook — all streaming logic removed. Close/clear only on `ok === true` from `submit`.
- Notes: `useEditStream` is the single source of truth for all AI edit logic. The CommandPalette remains available via Cmd+K for general (no-element-selected) edits.

## [2026-03-31] Persistence layer: IndexedDB auto-save + File System Access API
- VFS and history snapshots now survive browser refresh. On mount, `App.tsx` restores from IndexedDB before rendering the editor; if nothing is stored, the sample composition loads as before.
- `src/persistence/idb.ts`: `restoreFromIDB()` reads all three IDB stores (`vfs`, `history`, `meta`). `applyRestoredState()` hydrates the store and rebuilds the temporal map from the active file. `subscribeToStore()` subscribes to Zustand and debounces writes at 500ms — only fires when `files`, `snapshots`, or `activeFilePath` reference changes.
- `src/persistence/filesystem.ts`: `openFileFromDisk()` uses `showOpenFilePicker` (FSAA) and stores the file handle; falls back to returning `{ ok: false }` so `FileTreePanel` can fall through to the hidden `<input>`. `saveFileToDisk(path)` writes silently if a handle exists, shows Save As dialog otherwise, falls back to Blob download in Firefox/Safari.
- `src/store.ts`: `vfsSlice` gains `fileHandles: Map<string, FileSystemFileHandle>`, `setFileHandle`, `clearFileHandle` (session-only, not persisted). `uiSlice` gains `hydrated: boolean` + `setHydrated`.
- `src/App.tsx`: hydration gate — renders "Loading project..." until IDB restore completes, then starts auto-save subscription.
- `src/editor/layout/PreviewPanel.tsx`: sample loading skipped when `files.size > 0` (IDB restored).
- `src/editor/layout/FileTreePanel.tsx`: Upload button now calls `openFileFromDisk()` first (FSAA), falls back to `<input>`. Save button added (calls `saveFileToDisk`).
- `src/editor/layout/EditorLayout.tsx`: Cmd+S / Ctrl+S shortcut calls `saveFileToDisk(activeFilePath)`.
- Notes: `OpenFilePickerOptions` / `SaveFilePickerOptions` / `showOpenFilePicker` / `showSaveFilePicker` are not in TypeScript's DOM lib at v5.5 — minimal ambient declarations are at the top of `filesystem.ts`. History is capped at 20 snapshots in IDB (vs 50 in memory) to limit storage size.

## [2026-03-30] Compiler: registerRoot stubs + smarter root component resolution
- `registerRoot` and `Composition` are now injected as no-ops into the compiler's REMOTION_APIS map. Claude-generated code that follows Remotion's registerRoot pattern no longer throws runtime errors in the browser Player context.
- `resolveRootComponent` now collects all uppercase-named functions in declaration order and skips known root-wrapper names (`RemotionRoot`, `Root`, `registerRoot`). Returns the last non-wrapper candidate, falling back to any non-wrapper function.
- Files: `src/engine/compiler.ts`
- Notes: `ROOT_WRAPPER_NAMES` is a Set at module scope — add to it if new wrapper patterns appear in Claude output.

## [2026-03-30] Context assembler: fallback for elements not in temporal map
- `assembleEditContext` no longer early-returns when `temporalMap` is null. It still returns a valid context with no `selectedElement`.
- When an element is selected but has no node in the temporal map (e.g. compositions without Sequence wrappers), the assembler extracts `componentName` and `lineStart` from the element ID format `"{componentName}:{lineNumber}"` and constructs a plain-language frame narrative. Claude can still target the edit using source location.
- Files: `src/ai/context-assembler.ts`

## [2026-03-30] PropertiesPanel: fallback display for elements not in temporal map
- When `selectedElementId` is set but the element has no node in the temporal map, the panel now shows the component name and line number extracted from the element ID instead of showing nothing.
- Files: `src/editor/layout/PropertiesPanel.tsx`

## [2026-03-30] PreviewPanel: player error handling + edit mode hides controls
- Player `error` events are now caught and stored as `compilationError` on the active file via `setCompilationStatus`, surfacing render errors in the PropertiesPanel status bar.
- Player `controls` prop is now gated on `!editMode` — the built-in Remotion controls are hidden when the overlay is active so clicks reach the inspector instead.
- Files: `src/editor/layout/PreviewPanel.tsx`

## [2026-03-30] Plans: IndexedDB + File System Access API persistence plan added
- `Plans/persistence-plan.md` documents a two-layer persistence strategy: IndexedDB auto-save for VFS + history on every change, and File System Access API for open-from-disk / Cmd+S save-back. Not yet implemented — plan only.
- Files: `Plans/persistence-plan.md`

## [2026-03-30] FileTreePanel: file upload via browse button
- An "Upload" button was added alongside "New File" in the FileTreePanel footer. Accepts `.tsx` and `.ts` files only (validated on selection). Reads file content via `FileReader`, calls `createFile` + `setActiveFile`. Handles filename collisions by appending a numeric suffix.
- Files: `src/editor/layout/FileTreePanel.tsx`
