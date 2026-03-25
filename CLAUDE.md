# MotionLM

A browser-based AI-first visual editor for Remotion compositions — click any element at any frame, describe an edit in natural language, see it applied live.

---

## Tech Stack

| Concern | Package | Version |
|---|---|---|
| Build tool | Vite | 6.x |
| UI framework | React | 19.x |
| Language | TypeScript | 5.x (strict) |
| Styling | Tailwind CSS | v4 |
| State | Zustand | latest |
| Video engine | Remotion + @remotion/player | v4 |
| In-browser compiler | @babel/standalone | latest |
| AST parsing | @babel/parser + @babel/traverse + @babel/types | latest |
| UI primitives | Radix UI | latest |
| Icons | Lucide React | latest |
| Command palette | cmdk | latest |
| Local render server | Express + @remotion/renderer | latest |
| AI | Anthropic API (claude-sonnet-4-20250514, BYOK) | latest SDK |

---

## Architecture Map

```
motionlm/
  bin/
    motionlm.js               # CLI entry: starts Vite dev server + render server + opens browser
  src/
    main.tsx                  # App entry point
    App.tsx                   # Root layout
    store.ts                  # Single Zustand store (all slices composed here)
    engine/
      compiler.ts             # Babel JIT compilation pipeline (transform + Function constructor)
      babel-plugins/
        import-stripper.ts    # Babel visitor: removes ImportDeclaration + ExportNamedDeclaration
        source-map.ts         # Babel visitor: injects data-motionlm-* attributes onto JSX elements
      temporal/
        parser.ts             # Pure function: (sourceCode: string) => TemporalMap
        types.ts              # TemporalMap, TemporalNode, AnimationDescriptor type definitions
    inspector/
      Overlay.tsx             # Transparent overlay over Player: hover highlight + click-to-select
      highlight.ts            # Bounding box rendering, scale correction logic
    editor/
      layout/
        EditorLayout.tsx      # Main four-panel shell
        PreviewPanel.tsx      # Player + Overlay container
        TimelinePanel.tsx     # Sequence timeline strip with draggable playhead
        PropertiesPanel.tsx   # Selected element info, animations, draft error display
        FileTreePanel.tsx     # VFS file browser
      prompt/
        CommandPalette.tsx    # Cmd+K prompt interface
        ContextDisplay.tsx    # Inline selection context (element name, frame, animation state)
      history/
        VersionHistory.tsx    # VFS snapshot list with undo
    ai/
      client.ts               # Claude API client: BYOK, streaming, error handling
      context-assembler.ts    # Assembles source + temporal map + frame narrative for Claude
      system-prompt.ts        # Remotion API reference + editing rules injected into every request
      diff-parser.ts          # Parses Claude's structured EditResponse output
    samples/                  # Sample Remotion compositions for testing the temporal engine
      simple-text.tsx
      multi-sequence.tsx
      spring-animation.tsx
      nested-components.tsx
      complex-timeline.tsx
  server/
    render-server.ts          # Express server: POST /api/render, SSE progress stream
    render-handler.ts         # Writes VFS to temp dir, calls renderMedia(), returns file path
  Plans/                      # Architecture plans and design docs (read-only reference)
  index.html
  vite.config.ts
  tailwind.config.ts
  tsconfig.json
  package.json
  .env.example
```

### State Slices (all in `src/store.ts`)

- **vfsSlice** — `Map<string, VFSFile>` with `activeCode` / `draftCode` / `compilationStatus` per file
- **temporalSlice** — current `TemporalMap`, rebuilt when `activeCode` changes
- **selectionSlice** — selected element ID, current frame, edit mode flag
- **historySlice** — array of VFS snapshots with timestamp + description
- **playerSlice** — playing/paused, current frame, duration, fps
- **uiSlice** — panel visibility, active tool, command palette open/closed
- **settingsSlice** — API key (persisted to localStorage), model preference, theme

---

## Coding Conventions

### Naming
- Components: `PascalCase` in `PascalCase.tsx`
- Utilities, hooks, non-component modules: `camelCase.ts`
- Zustand slices: `camelCaseSlice` in `store.ts`
- Types/interfaces: `PascalCase`, defined in module or `src/engine/temporal/types.ts` for shared engine types
- Constants: `SCREAMING_SNAKE_CASE`
- Zustand store actions: verb-first, e.g., `promoteVfsDraft`, `setSelection`, `pushHistorySnapshot`

### File patterns
- One component per file
- Co-locate narrow helper logic with the file that uses it; only extract to a shared utility when two or more files need it
- Barrel `index.ts` files only where they genuinely reduce import verbosity (engine/ and ai/ subdirs)

### Error handling
- All errors at API boundaries (Claude client, render server calls) return `{ ok: false; error: string }` — never throw across async boundaries
- Compilation errors are stored in `VFSFile.compilationError`, not thrown
- Use early returns with typed error unions; avoid nested try/catch chains
- Never expose raw error messages or stack traces to the user — map them to human-readable descriptions

### Imports
- Use named exports everywhere; no default exports
- Absolute imports via `@/` alias (configured in `tsconfig.json` and `vite.config.ts`)
- Group imports: external packages, then `@/` internal paths, then relative paths. One blank line between groups.
- No unused imports — remove immediately

---

## Dev Commands

```bash
npx motionlm          # Start Vite dev server (port 3000) + render server (port 3001) + open browser (run manually — Claude will not run this)
npm run dev           # Vite dev server only (no render server)
npm run build         # Production build
npm run typecheck     # tsc --noEmit (no emit, type check only)
npm run lint          # ESLint
npm run test          # Vitest (unit tests for engine/temporal and engine/compiler)
```

---

## Hard Rules

### NEVER
- `any` types — use `unknown` and narrow, or define the proper type
- Default exports — named exports only
- Inline styles — Tailwind classes only
- Direct DOM manipulation outside `src/inspector/` — the only code allowed to touch the DOM directly is the overlay hit-detection logic in `Overlay.tsx` and `highlight.ts`
- Store API keys in source code — all secrets via environment variables
- Regex-based import stripping — use the Babel visitor plugin in `import-stripper.ts`
- Overwrite `activeCode` directly with Claude's output — always write to `draftCode` first, compile, then promote on success
- Send screenshot to Claude by default — context bundle is source + temporal map + frame narrative only
- Use the TypeScript compiler API for AST work — use `@babel/parser` + `@babel/traverse` (already loaded via `@babel/standalone`)
- Separate Zustand stores for different state domains — one store, slices pattern
- Attempt incremental compilation mid-stream — apply code only after a complete code block is received

### ALWAYS
- TypeScript strict mode: `"strict": true` in `tsconfig.json`
- Validate input at every API/server boundary with zod schemas
- Write `draftCode` before compilation; promote to `activeCode` only on compilation success
- Revert to `activeCode` (keep working preview) if draft compilation fails
- Build temporal map as a pure function: `(sourceCode: string) => TemporalMap` — no DOM, no React, no store access
- Use Babel visitor for import/export removal during `Babel.transform()`, not regex
- Inject `data-motionlm-id`, `data-motionlm-line`, `data-motionlm-component` via Babel source-map plugin at compile time
- Deduct credits / expensive operations: initiate before the operation, refund on failure (if billing is added in Phase 6)
- All cross-slice state updates in a single Zustand `set()` call to prevent intermediate inconsistent UI

---

## Communication

- Do not use emojis in code, comments, commit messages, or responses.
- Be direct and concise. No filler phrases.
- When referencing code, include file path and line number.

---

## Code Style

- Use TypeScript strict mode throughout. No `any` types — use `unknown` and narrow, or define the proper type.
- Use named exports, not default exports.
- Prefer `const` arrow functions for components and utilities.
- Use early returns to reduce nesting.
- No unused imports or variables — clean as you go.
- Tailwind classes only for styling. No inline styles, no CSS modules.
- Radix UI components are the base — extend them, do not rebuild from scratch.

---

## Project Structure

- Plans and documentation live in `/Plans/`.
- `Plan.md` (active working plan) stays at project root.
- All other plans: save to `Plans/` directory (not `.claude-ghostty/`). Use filename pattern: `Plans/[topic]-plan.md` (e.g., `Plans/phase-5-plan.md`).
- Shared engine types live in `src/engine/temporal/types.ts`.
- AI layer lives in `src/ai/` — client, context assembler, system prompt, diff parser.
- All environment variables must be documented in `.env.example` with descriptions.
- The render server (`server/`) is Node.js only — no browser APIs. It lives at the project root alongside `src/`, not inside it.

---

## Git

- Do not commit unless explicitly asked.
- Do not push unless explicitly asked.
- Commit messages: imperative mood, lowercase, no period. Example: `add temporal map parser for sequence boundaries`
- No auto-generated or AI-attribution in commit messages unless asked.

---

## Development

- When creating API routes or server handlers, always validate input at the boundary (zod schemas).
- Always handle API errors gracefully — return structured error responses, never expose raw errors.
- Temporal map rebuilds must complete under 200ms for a ~500-line composition — profile with `performance.now()`.
- The Babel JIT compilation pipeline follows Remotion's proven approach: `Babel.transform()` with plugins, then `new Function()` constructor with injected Remotion APIs.
- The render server runs on port 3001 alongside Vite on port 3000. Use Vite's proxy config for `/api/render` in development.

## Testing Changes

- After writing engine/compiler or engine/temporal code, describe a curl command or test scenario.
- After writing editor UI code, describe what the user should see and which interactions to test.
- The five sample compositions in `src/samples/` are the canonical test suite for the temporal engine.

---

## Key Reference

- Full architecture plan and build phases: `/Plans/motionlm_complete_architecture_plan.md`
- Remotion v4 docs: https://www.remotion.dev/docs
- @babel/standalone usage: https://babeljs.io/docs/babel-standalone

## plan management and status protocol
1. The Source of Truth
- PLAN.md at the project root is the authoritative roadmap.

- Context Loading: At the start of every session or when context is cleared, read PLAN.md to determine the current state.

- Refer to `/Plans/motionlm_complete_archit
  ecture_plan.md` when a task is ambiguous
  or when you need design rationale — it is
   not required for routine task execution.
   PLAN.md is the authoritative task list
  and is self-contained.

2. Atomic Task Execution
- One Task at a Time: Do not attempt multiple tasks from PLAN.md simultaneously unless explicitly authorized. Focus on completing the current task to the highest standard before moving on.

- Pre-Task Sync: Before writing any code for a task, update its status in PLAN.md to [/] (In Progress).

- Post-Task Sync: Upon completion, update the status to [x] (Done) and append the primary file path(s) created or modified in parentheses.
Example: - [x] Implement temporal parser logic (src/engine/temporal/parser.ts)