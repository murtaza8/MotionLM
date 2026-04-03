# MotionLM — Execution Plan
This is an archived document. The plan here is already implemented.

MotionLM is a browser-based AI-first visual editor for Remotion compositions. Users click any element at any frame, describe an edit in natural language, and see it applied live. The core technical contribution is temporal awareness: extracting animation timing, Sequence boundaries, and frame-relative state from Remotion source code via AST analysis, then assembling that context for Claude to make precise edits.

This plan breaks the build into 30 session-sized tasks across 7 phases (0-6). Each task targets specific files and includes concrete verification steps.

---

## Critique and Improvements

The following changes were made relative to the original architecture plan in `/Plans/motionlm_complete_architecture_plan.md`:

**1. Tailwind CSS v4 configuration model.** The original plan references `tailwind.config.ts` for design tokens (shadows, keyframes, timing functions). Tailwind v4 uses CSS-first configuration via `@theme` directives in CSS files. All Liquid Glass design tokens move to `@theme` in `src/index.css`. The `tailwind.config.ts` file remains only for plugins if needed.

**2. Liquid Glass design tokens in Phase 0.** The original plan describes the design system in detail but does not include it in Phase 0's task list. Design tokens and glass utility classes are now explicitly Task 0.2, ensuring every subsequent phase builds on a consistent visual foundation.

**3. Incremental store slices.** The original plan builds all 7 Zustand slices in Phase 0. This is premature -- temporalSlice has no backing engine until Phase 1, selectionSlice has no inspector until Phase 2, etc. Slices are now introduced in the phase that first needs them: vfsSlice + playerSlice + settingsSlice in Phase 0, temporalSlice in Phase 1, selectionSlice in Phase 2, uiSlice + historySlice in Phase 4.

**4. Minimal editor shell in Phase 0.** The original plan defers all UI to Phase 4. This means Phases 1-3 have no visual home for testing. A minimal EditorLayout + PreviewPanel is now part of Phase 0, providing a live preview surface from the start.

**5. Missing zod dependency.** The plan requires zod for API boundary validation (CLAUDE.md rule: "Validate input at every API/server boundary with zod schemas") but zod is not in the original dependency list. Added to Phase 0 scaffolding.

**6. Phase ordering preserved, UI shell moved early.** The original Phase 3 (Claude integration) before Phase 4 (UI) ordering is retained because the edit loop is the core feature and must be proven early. However, the minimal shell from Phase 0 and the PropertiesPanel added in Phase 2 give Claude integration a sufficient UI surface to test against.

---

## Status Protocol

- `[ ]` Todo
- `[/]` In Progress
- `[x]` Done
- `[!]` Blocked

---

## Phase 0: Foundation + Design System

**Goal**: A working Vite + React 19 app with Tailwind v4, Liquid Glass design tokens, Zustand store (3 slices), Babel JIT compiler, and a minimal editor shell rendering a sample composition via Remotion Player.

### Task 0.1: Scaffold project and install dependencies
`[x]` (package.json, tsconfig.json, tsconfig.node.json, vite.config.ts, index.html, .env.example, src/main.tsx, src/App.tsx, src/index.css)

**Target files**: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.env.example`

- Initialize npm project. Install all dependencies:
  - Core: `react@19`, `react-dom@19`, `typescript@5`, `vite@6`, `@vitejs/plugin-react`
  - Styling: `tailwindcss@4`, `@tailwindcss/vite`
  - State: `zustand`
  - Video: `remotion@4`, `@remotion/player@4`
  - Compilation: `@babel/standalone`
  - AST: `@babel/parser`, `@babel/traverse`, `@babel/types`
  - UI: `@radix-ui/react-dialog`, `@radix-ui/react-popover`, `@radix-ui/react-tooltip`, `@radix-ui/react-toggle`, `lucide-react`, `cmdk`
  - Validation: `zod`
  - Dev: `@types/react`, `@types/react-dom`, `@types/babel__standalone`, `@types/babel__traverse`, `eslint`, `vitest`
- Configure `tsconfig.json` with `"strict": true` and `@/` path alias
- Configure `vite.config.ts` with React plugin, `@/` resolve alias, and proxy for `/api` to port 3001
- Create `index.html` with root div
- Create `.env.example` with `ANTHROPIC_API_KEY` placeholder and description
- Create `src/main.tsx` entry point rendering `<App />`
- Create `src/App.tsx` as minimal shell

**Verification**:
- `npm run dev` starts without errors
- `npm run typecheck` passes
- Browser shows the App component at `localhost:5173`
- `@/` imports resolve correctly in a test import

### Task 0.2: Liquid Glass design tokens and utility classes
`[x]` (src/index.css, src/App.tsx)

**Target files**: `src/index.css`

- Define all CSS custom properties under Tailwind v4's `@theme` directive:
  - Base surfaces: `--color-base`, `--color-base-raised`, `--color-base-muted`
  - Glass backgrounds: `--glass-bg-0` through `--glass-bg-3`
  - Glass borders: `--glass-border-subtle`, `--glass-border-default`, `--glass-border-strong`
  - Text: `--text-primary`, `--text-secondary`, `--text-tertiary`
  - Accent tints: `--accent-blue-glass`, `--accent-amber-glass`, `--accent-red-glass`, `--accent-green-glass`
- Extend Tailwind theme via `@theme` for: `box-shadow` tokens (`glass-sm`, `glass-md`, `glass-lg`, `glass-xl`, `glow-blue`, `glow-amber`, `glow-red`), `transition-timing-function` tokens (`spring-out`, `ease-glass`), `keyframes` (`glass-appear`, `shimmer`), `animation` (`glass-appear`, `shimmer`)
- Define glass utility classes in `@layer utilities`: `.glass-panel`, `.glass-elevated`, `.glass-modal`, `.glass-well`, `.glass-tint-blue`, `.glass-tint-amber`, `.glass-tint-red`, `.glass-hover`
- Add base layer styles: antialiased font smoothing, `overflow: hidden` on body, `prefers-reduced-motion` override
- Set body background to `var(--color-base)`

**Verification**:
- `npm run dev` loads without CSS errors
- Inspect the body element in DevTools: background is `#08080a`, CSS variables are present on `:root`
- Create a temporary test div with `className="glass-panel"` -- it renders with the correct semi-transparent background, border, and blur
- `prefers-reduced-motion` media query is present and sets animation durations to `0.01ms`

### Task 0.3: Zustand store with initial slices
`[x]` (src/store.ts)

**Target files**: `src/store.ts`

- Create single Zustand store using the slices pattern
- Implement **vfsSlice**:
  - State: `files: Map<string, VFSFile>`, `activeFilePath: string | null`
  - `VFSFile` interface: `activeCode: string`, `draftCode: string | null`, `compilationStatus: 'idle' | 'compiling' | 'success' | 'error'`, `compilationError: string | null`
  - Actions: `setActiveCode(path, code)`, `setDraftCode(path, code)`, `promoteDraft(path)`, `discardDraft(path)`, `setCompilationStatus(path, status, error?)`, `setActiveFile(path)`
- Implement **playerSlice**:
  - State: `isPlaying: boolean`, `currentFrame: number`, `durationInFrames: number`, `fps: number`
  - Actions: `setPlaying(bool)`, `setCurrentFrame(n)`, `setCompositionMeta(duration, fps)`
- Implement **settingsSlice**:
  - State: `apiKey: string | null`, `modelPreference: 'sonnet' | 'opus'`, `theme: 'dark'`
  - Actions: `setApiKey(key)`, `setModelPreference(model)`
  - Persist `apiKey` and `modelPreference` to `localStorage` via Zustand `persist` middleware (settings slice only)
- Export typed `useStore` hook with selector support

**Verification**:
- `npm run typecheck` passes with no errors
- In a test component, call `useStore(s => s.files)` -- returns empty Map
- Call `setActiveCode('/main.tsx', 'const x = 1')`, then read back -- returns the VFSFile with correct `activeCode`
- `setDraftCode` + `promoteDraft` flow works: draftCode becomes activeCode, draftCode becomes null
- Settings persist across page reload (check localStorage)

### Task 0.4: Babel JIT compiler pipeline
`[x]` (src/engine/compiler.ts, src/engine/babel-plugins/import-stripper.ts)

**Target files**: `src/engine/compiler.ts`, `src/engine/babel-plugins/import-stripper.ts`

- Implement `import-stripper.ts`: Babel visitor plugin that removes `ImportDeclaration`, unwraps `ExportNamedDeclaration` (keeps the declaration, removes the export wrapper), unwraps `ExportDefaultDeclaration`
- Implement `compiler.ts`:
  - `compileComposition(sourceCode: string): { ok: true; Component: React.ComponentType } | { ok: false; error: string }`
  - Pipeline: (1) `Babel.transform()` with presets `['react', 'typescript']` and plugins `[importStripperPlugin]`, (2) extract the last function/const component declaration as the root component, (3) construct via `new Function()` with injected Remotion APIs: `React`, `AbsoluteFill`, `useCurrentFrame`, `useVideoConfig`, `spring`, `interpolate`, `Sequence`, `Easing`, `Img`, `staticFile`
  - Wrap the `new Function()` call in try/catch -- compilation errors return `{ ok: false, error }`, never throw
  - Export a `useCompilation` hook or integration function that watches `draftCode` or `activeCode` changes in the store, runs compilation, and updates `compilationStatus`

**Verification**:
- Write a simple composition string: `import { AbsoluteFill } from 'remotion'; export const MyComp = () => <AbsoluteFill><h1>Hello</h1></AbsoluteFill>;`
- `compileComposition(source)` returns `{ ok: true, Component }` where Component is a valid React component
- Import stripping handles multiline imports, aliased imports, `export default`
- Passing invalid JSX returns `{ ok: false, error: '...' }` with a human-readable message
- `npm run typecheck` passes

### Task 0.5: Minimal editor shell with Remotion Player
`[x]` (src/editor/layout/EditorLayout.tsx, src/editor/layout/PreviewPanel.tsx, src/samples/simple-text.tsx, src/App.tsx)

**Target files**: `src/editor/layout/EditorLayout.tsx`, `src/editor/layout/PreviewPanel.tsx`, `src/samples/simple-text.tsx`

- Create `simple-text.tsx` sample composition: a single text element with opacity fade using `interpolate()` and `useCurrentFrame()`, wrapped in `AbsoluteFill`. This is stored as a string constant, not imported as a module.
- Create `EditorLayout.tsx`: CSS Grid shell matching the layout spec:
  - `grid-rows: [toolbar 44px] [main 1fr] [timeline 160px]`
  - `grid-cols: [filetree 240px] [preview 1fr] [properties 280px]`
  - Toolbar: placeholder div with `glass-elevated` class, `col-span-3`
  - FileTree: placeholder div with `glass-panel`, `border-r`
  - Preview: `PreviewPanel` component, `bg-[var(--color-base)]` (NO glass class, NO backdrop-filter)
  - Properties: placeholder div with `glass-panel`, `border-l`
  - Timeline: placeholder div with `glass-elevated`, `col-span-3`, `border-t`
- Create `PreviewPanel.tsx`:
  - On mount, load the sample composition source into the VFS store
  - Compile it via `compileComposition()`
  - Render it inside Remotion's `<Player>` component with `compositionWidth={1920}`, `compositionHeight={1080}`, `fps={30}`, `durationInFrames` from sample
  - Player controls: play/pause, frame display
  - Sync Player state to `playerSlice` (currentFrame, isPlaying)
- Wire `App.tsx` to render `EditorLayout`

**Verification**:
- `npm run dev` shows the four-panel glass layout with dark base background
- The Remotion Player in the center panel renders the "Hello" text with opacity animation
- Play/pause works, frame counter updates
- Glass panels have visible frosted-glass effect (backdrop blur) against the dark base
- The preview area has NO backdrop-filter (verify in DevTools)
- Resizing the window: grid adapts, player scales proportionally

---

## Phase 1: Temporal Engine

**Goal**: A pure-function AST parser that produces a TemporalMap from Remotion source code, tested against 5 sample compositions of increasing complexity.

### Task 1.1: Temporal types and sample compositions
`[x]` (src/engine/temporal/types.ts, src/samples/multi-sequence.tsx, src/samples/spring-animation.tsx, src/samples/nested-components.tsx, src/samples/complex-timeline.tsx)

**Target files**: `src/engine/temporal/types.ts`, `src/samples/simple-text.tsx`, `src/samples/multi-sequence.tsx`, `src/samples/spring-animation.tsx`, `src/samples/nested-components.tsx`, `src/samples/complex-timeline.tsx`

- Define types in `types.ts`:
  - `TemporalNode`: `id`, `sourceRange: [number, number]`, `componentName`, `activeFrameRange: [number, number] | null`, `animations: AnimationDescriptor[]`, `sequencePath: string[]`
  - `AnimationDescriptor`: `property`, `type: 'interpolate' | 'spring' | 'dynamic'`, `frameRange: [number, number]`, `valueRange: [number, number]`, `easing?`, `springConfig?`, `sourceExpression`
  - `TemporalMap`: `nodes: Map<string, TemporalNode>`, `compositionDuration`, `fps`
- Create all 5 sample compositions as string constants (not modules):
  1. `simple-text.tsx`: Single text with opacity fade via `interpolate()`
  2. `multi-sequence.tsx`: 3 elements in separate `<Sequence>` blocks with different `from`/`durationInFrames`
  3. `spring-animation.tsx`: Element with `spring()` entrance + `interpolate()` positioning
  4. `nested-components.tsx`: Component defined inline, used inside a Sequence, with local `useCurrentFrame()` math (`frame - offset`)
  5. `complex-timeline.tsx`: Overlapping Sequences, conditional rendering based on frame, multiple animations on one element

**Verification**:
- `npm run typecheck` passes -- all types are well-formed
- Each sample composition compiles successfully via `compileComposition()` (from Task 0.4)
- Each sample renders correctly in the Remotion Player (swap the VFS source in the store, verify visually)

### Task 1.2: AST parser -- Sequence boundaries and animation extraction
`[x]` (src/engine/temporal/parser.ts)

**Target files**: `src/engine/temporal/parser.ts`

- Implement the core pure function: `parseTemporalMap(sourceCode: string): TemporalMap`
- Use `@babel/parser` with `jsx` and `typescript` plugins to parse source into AST
- Use `@babel/traverse` to walk the AST:
  - **Sequence extraction**: Find `<Sequence>` JSX elements, extract `from` and `durationInFrames` props (handle literal numbers and simple expressions). For nested Sequences, resolve to absolute frame ranges by summing parent offsets.
  - **interpolate() extraction**: Find `interpolate()` call expressions. Extract: first argument (frame variable), second argument (inputRange array of literals), third argument (outputRange array of literals), optional fourth argument (config object with extrapolateLeft/Right). Walk up the AST to find which style property this feeds into.
  - **spring() extraction**: Find `spring()` call expressions. Extract: the config object properties (frame, fps, config: { damping, stiffness, mass }). Walk up to find the target style property.
- For expressions that cannot be statically evaluated (computed ranges, dynamic values), create an `AnimationDescriptor` with `type: 'dynamic'` and store the raw source expression.
- Map each JSX element to a `TemporalNode` with a generated `id` based on component name + line number.

**Verification**:
- `parseTemporalMap(simpleTextSource)` returns a TemporalMap with 1 node, 1 interpolate animation with correct frame/value ranges
- `parseTemporalMap(multiSequenceSource)` returns 3 nodes with correct absolute frame ranges from their Sequence parents
- `parseTemporalMap(springAnimationSource)` returns a node with both a spring and interpolate animation descriptor
- Performance: `performance.now()` around the parse call shows < 50ms for any sample (well under 200ms target)

### Task 1.3: useCurrentFrame flow tracing and component mapping
`[x]` (src/engine/temporal/parser.ts)

**Target files**: `src/engine/temporal/parser.ts` (extend)

- Extend the parser to trace `useCurrentFrame()` bindings:
  - Find `useCurrentFrame()` call, identify the variable it binds to (e.g., `const frame = useCurrentFrame()`)
  - Track arithmetic transformations: `const localFrame = frame - 30` creates a derived binding with offset -30
  - When `interpolate(localFrame, ...)` is found, resolve the actual frame range by applying the inverse of the arithmetic transformation to the input range
- Implement component-to-Sequence mapping:
  - For each JSX element, walk up the AST to find the nearest `<Sequence>` ancestor
  - Record the Sequence chain in `TemporalNode.sequencePath`
  - If no Sequence ancestor, `activeFrameRange` is `null` (always visible)
- Handle inline component definitions: when a component is defined as a const arrow function within the same file and used in JSX, resolve its content for temporal analysis

**Verification**:
- `nested-components.tsx` sample: the parser correctly resolves `localFrame = frame - 30` and adjusts animation frame ranges accordingly
- `complex-timeline.tsx` sample: overlapping Sequences produce nodes with correct absolute frame ranges
- Every node has a valid `sequencePath` (empty array if no Sequence ancestor, array of Sequence names otherwise)
- `npm run typecheck` passes

### Task 1.4: temporalSlice and Vitest tests
`[x]` (src/store.ts, src/engine/temporal/__tests__/parser.test.ts)

**Target files**: `src/store.ts` (extend with temporalSlice), `src/engine/temporal/__tests__/parser.test.ts`

- Add **temporalSlice** to the Zustand store:
  - State: `temporalMap: TemporalMap | null`
  - Action: `rebuildTemporalMap(sourceCode: string)` -- calls `parseTemporalMap()` and stores the result
  - Integration: when `activeCode` changes in vfsSlice (via `promoteDraft` or `setActiveCode`), automatically rebuild the temporal map in the same `set()` call
- Write Vitest tests for `parseTemporalMap()` against all 5 samples:
  - `simple-text.tsx`: 1 node, 1 interpolate animation, no Sequence
  - `multi-sequence.tsx`: 3 nodes, each with correct absolute frame ranges
  - `spring-animation.tsx`: spring config extracted correctly (damping, stiffness, mass)
  - `nested-components.tsx`: frame offset arithmetic resolved correctly
  - `complex-timeline.tsx`: overlapping Sequences, conditional rendering flagged as dynamic
- Test edge cases: empty source returns empty map, syntax errors return empty map (not throw), source with no Remotion APIs returns map with nodes but no animations

**Verification**:
- `npm run test` passes all temporal parser tests
- In the running app, change the VFS source via devtools or a test button -- the temporal map rebuilds and is visible in the store (use Zustand devtools or `console.log`)
- `npm run typecheck` passes

---

## Phase 2: Visual Inspector

**Goal**: An overlay on the Remotion Player that enables hover highlighting and click-to-select, with source mapping from DOM elements back to source code and temporal context.

### Task 2.1: Babel source-map plugin
`[x]` (src/engine/babel-plugins/source-map.ts, src/engine/compiler.ts)

**Target files**: `src/engine/babel-plugins/source-map.ts`, `src/engine/compiler.ts` (update to include plugin)

- Implement `source-map.ts`: a Babel visitor plugin that injects attributes onto every JSX opening element:
  - `data-motionlm-id="el-{lineNumber}"` -- unique identifier based on line number
  - `data-motionlm-line="{lineNumber}"` -- source line for mapping back
  - `data-motionlm-component="{componentName}"` -- the enclosing component name (found by walking up to the nearest function/arrow function declaration)
- The plugin runs during `Babel.transform()` in `compiler.ts` -- add it to the plugins array alongside `import-stripper`
- Handle edge cases: fragment shorthand `<>...</>` (cannot add attributes -- skip), spread attributes (insert before spreads so user spreads can override)

**Verification**:
- Compile a sample composition, inspect the transformed code -- every JSX element has `data-motionlm-*` attributes
- In the running Player, open DevTools and inspect rendered elements -- `data-motionlm-id`, `data-motionlm-line`, `data-motionlm-component` attributes are present on DOM nodes
- Fragments are not broken (no runtime error)
- `npm run typecheck` passes

### Task 2.2: Overlay with hover highlighting
`[x]` (src/inspector/highlight.ts, src/inspector/Overlay.tsx, src/store.ts, src/editor/layout/PreviewPanel.tsx)

**Target files**: `src/inspector/Overlay.tsx`, `src/inspector/highlight.ts`

- Implement `highlight.ts`:
  - `getHighlightBox(element: HTMLElement, containerRect: DOMRect, scale: number): { top, left, width, height }` -- computes a bounding box adjusted for the Player's scale factor
  - Render styles: hover state = `border: 1.5px solid rgba(59,130,246,0.60)` with inset shadow; selected state = `border: 2px solid rgba(59,130,246,0.90)` with glow shadow
- Implement `Overlay.tsx`:
  - A transparent `<div>` positioned absolutely over the Player container
  - `pointer-events: auto` when in edit mode (read from store), `pointer-events: none` otherwise
  - On `mousemove`: temporarily set overlay to `pointer-events: none`, call `document.elementFromPoint(x, y)`, restore, read `data-motionlm-*` attributes from the hit element
  - Render a highlight box div tracking the hovered element's bounding rect
  - Use `requestAnimationFrame` for smooth highlight tracking
  - Show a small tooltip near the highlight with the component name
- Integrate Overlay into `PreviewPanel.tsx` -- render it as a sibling overlaying the Player

**Verification**:
- In edit mode, hover over elements in the Player -- a blue highlight box tracks the element
- The highlight box correctly accounts for Player scaling (test by resizing the browser)
- Moving the mouse off an element removes the highlight
- Outside edit mode, the overlay does not intercept mouse events (Player controls work normally)
- No backdrop-filter on the overlay (verify in DevTools)

### Task 2.3: Click-to-select and selectionSlice
`[x]` (src/store.ts, src/inspector/Overlay.tsx, src/editor/layout/EditorLayout.tsx)

**Target files**: `src/store.ts` (extend with selectionSlice), `src/inspector/Overlay.tsx` (extend)

- Add **selectionSlice** to the Zustand store:
  - State: `selectedElementId: string | null`, `selectedFrame: number | null`, `editMode: boolean`
  - Actions: `setSelection(elementId, frame)`, `clearSelection()`, `toggleEditMode()`, `setEditMode(bool)`
  - When edit mode activates, pause the player (cross-slice: set `isPlaying: false` in the same `set()` call)
  - When temporal map rebuilds, validate that `selectedElementId` still exists in the new map -- clear if not
- Extend `Overlay.tsx` click handler:
  - On click: read `data-motionlm-id` from hit element, read current frame from playerSlice, call `setSelection(id, frame)`
  - Selected element gets the stronger highlight style (glow)
  - Clicking empty space or pressing `Escape` calls `clearSelection()`
- Add keyboard shortcut: `E` key toggles edit mode (global keydown listener in `EditorLayout.tsx` or `App.tsx`)

**Verification**:
- Press `E` -- Player pauses, overlay becomes interactive
- Click an element -- it gets a selection highlight (stronger blue glow), store shows correct `selectedElementId` and `selectedFrame`
- Press `Escape` -- selection clears
- Press `E` again -- edit mode deactivates, overlay stops intercepting events
- When source code changes cause the selected element to disappear, selection auto-clears

### Task 2.4: PropertiesPanel with element info
`[x]` (src/editor/layout/PropertiesPanel.tsx, src/editor/layout/EditorLayout.tsx)

**Target files**: `src/editor/layout/PropertiesPanel.tsx`

- Replace the placeholder PropertiesPanel with a real implementation:
  - When no element is selected: show "Select an element to inspect" message
  - When an element is selected, look up the `TemporalNode` from the temporal map using `selectedElementId`:
    - Component name (from `data-motionlm-component`)
    - Source line range
    - Active frame range (or "Always visible" if null)
    - Current position indicator: "Frame {selectedFrame} -- {percentage}% through active range"
    - List of animations with parameters: type (interpolate/spring/dynamic), property, frame range, value range
    - For spring animations: show damping, stiffness, mass
    - For dynamic animations: show the raw source expression
  - Compilation status indicator: show current `compilationStatus` from VFS
  - If `compilationError` exists, show the error in a `glass-well glass-tint-red` box with monospace error text
- Use Tailwind classes throughout (no inline styles)

**Verification**:
- Select an element in the Player -- PropertiesPanel shows correct component name, frame range, and animation details
- The animation list matches what the temporal parser extracted for that element
- When no element is selected, the panel shows the placeholder message
- The panel uses glass styling consistent with the design system
- `npm run typecheck` passes

---

## Phase 3: Claude Integration

**Goal**: Click an element, type a natural language instruction in the command palette, see Claude's edit applied live with draft state safety.

### Task 3.1: Claude API client with BYOK and streaming
`[x]` (src/ai/client.ts, vite.config.ts)

**Target files**: `src/ai/client.ts`, `vite.config.ts` (update proxy)

- Implement `client.ts`:
  - `sendEditRequest(messages: Message[], apiKey: string, model: string): AsyncGenerator<StreamChunk>` -- streams Claude's response
  - Uses `fetch()` with `ReadableStream` to stream the response
  - For local dev: requests go to `/api/claude` which Vite proxies to `https://api.anthropic.com` (add proxy rule in `vite.config.ts`)
  - For production: requests go to the Cloudflare Worker proxy (configured in settingsSlice, built in Phase 6)
  - Error handling: network errors, 401 (bad API key), 429 (rate limit), 500 (API error) all return `{ ok: false, error: string }` with human-readable messages
  - Validate API key format before sending (starts with `sk-ant-`)
  - Use zod schema to validate the streaming response shape
- Type definitions: `Message`, `StreamChunk`, `EditResponse` (file, code, explanation, seekToFrame?)

**Verification**:
- With a valid API key in settings, calling `sendEditRequest` with a simple prompt streams back chunks
- With an invalid API key, returns `{ ok: false, error: 'Invalid API key' }`
- The Vite proxy forwards `/api/claude` requests correctly (check network tab)
- `npm run typecheck` passes
- No API key is hardcoded anywhere in source

### Task 3.2: System prompt with Remotion API reference
`[x]` (src/ai/system-prompt.ts)

**Target files**: `src/ai/system-prompt.ts`

- Build the system prompt as a template literal function that accepts composition context:
  - **Remotion API reference**: condensed signatures and common patterns for `interpolate()`, `spring()`, `useCurrentFrame()`, `useVideoConfig()`, `<Sequence>`, `<AbsoluteFill>`, `Easing` presets, `<Img>`, `staticFile()`
  - **Editing rules**:
    - Always return complete file contents (not partial diffs)
    - Preserve all existing animations unless explicitly asked to change them
    - Respect Sequence boundaries
    - Use `extrapolateRight: 'clamp'` by default on interpolate calls
    - Prefer `spring()` for entrance/exit, `interpolate()` for continuous changes
    - Never use `require()` or dynamic imports
    - All components must be valid React functional components
  - **Output format specification**: Claude must return a JSON object matching the `EditResponse` schema: `{ file, code, explanation, seekToFrame? }`
  - The prompt is structured so the API reference is in a `<remotion-api>` XML tag and the rules are in a `<editing-rules>` tag, making it easy for Claude to parse
- Export `buildSystemPrompt(): string` and `buildEditPrompt(context: EditContext): string`

**Verification**:
- `buildSystemPrompt()` returns a string containing the Remotion API reference and all editing rules
- The output format specification is clear and matches the `EditResponse` type
- No hardcoded API keys or sensitive data in the prompt
- `npm run typecheck` passes

### Task 3.3: Context assembler
`[x]` (src/ai/context-assembler.ts)

**Target files**: `src/ai/context-assembler.ts`

- Implement `assembleEditContext(store: StoreState): EditContext`:
  - Reads from the store: active file source code, selected element ID, selected frame, temporal map
  - Builds the context bundle:
    1. **Full source code** of the active file
    2. **Selected element info**: component name, source line range (from temporal map lookup)
    3. **Temporal context**: active frame range, list of animations with current state at the selected frame (e.g., "opacity interpolation: 75% complete, current value ~0.75")
    4. **Frame narrative**: a human-readable sentence describing the element's state. Example: "Frame 45 of 300. Element 'Title' is inside HeroSequence (frames 0-120). Opacity animation is 75% complete (interpolating from 0 to 1 over frames 0-60). Spring translateY animation has settled. Element is currently visible and fading in."
  - If no element is selected, provide only the source code and a note that no element is selected (for free-form edits)
- Implement `buildFrameNarrative(node: TemporalNode, frame: number): string` as a helper
- Export `assembleMessages(context: EditContext, instruction: string, systemPrompt: string): Message[]`

**Verification**:
- Select an element at a specific frame, call `assembleEditContext` -- the context includes correct source, element info, and frame narrative
- The frame narrative accurately describes animation states (test with simple-text sample at frame 0, midpoint, and end)
- With no selection, context still includes the source code
- `npm run typecheck` passes

### Task 3.4: Draft application flow
`[x]` (src/ai/diff-parser.ts, src/store.ts, src/editor/layout/PropertiesPanel.tsx)

**Target files**: `src/ai/diff-parser.ts`, `src/store.ts` (extend with draft promotion logic)

- Implement `diff-parser.ts`:
  - `parseEditResponse(rawResponse: string): { ok: true; edit: EditResponse } | { ok: false; error: string }`
  - Parses Claude's JSON response, validates with zod schema
  - Handles edge cases: response wrapped in markdown code fences, response with extra text before/after JSON
- Implement the full draft application flow as a store action or standalone function:
  1. Receive `EditResponse` from Claude
  2. Call `setDraftCode(edit.file, edit.code)` -- writes to VFS draft
  3. Call `compileComposition(edit.code)` -- attempt compilation
  4. **On success**: push current `activeCode` to history (cross-slice), call `promoteDraft(edit.file)` which copies draftCode to activeCode and clears draftCode, rebuild temporal map, validate selection -- all in one `set()` call
  5. **On failure**: set `compilationStatus: 'error'` and store the error. Preview stays on working `activeCode`. The draft and error are visible in PropertiesPanel.
  6. **Auto-retry on failure** (max 2 attempts): send the broken code + compiler error back to Claude with a retry prompt. If retry succeeds, promote. If all retries fail, leave the draft in place for manual intervention or discard.
- Add discard action: `discardDraft(path)` clears draftCode, resets compilationStatus to 'idle'
- Update PropertiesPanel to show draft error state with amber/red tint and "Fix" / "Discard" buttons

**Verification**:
- Simulate a successful edit: draft is written, compiled, promoted -- Player shows new content, temporal map rebuilds
- Simulate a failed edit (pass invalid code as Claude's response): Player stays on old content, PropertiesPanel shows error with red tint
- Click "Discard" -- draft clears, error clears, panel returns to normal state
- Auto-retry: on first compilation failure, the system automatically sends error context back (verify via console.log or mock)
- Version history contains the pre-edit snapshot (verify store state)
- `npm run typecheck` passes

---

## Phase 4: Full Editor UI

**Goal**: Command palette, timeline, file tree, version history, and keyboard shortcuts -- completing the four-panel editor.

### Task 4.1: CommandPalette with context display
`[x]` (src/editor/prompt/CommandPalette.tsx, src/editor/prompt/ContextDisplay.tsx, src/store.ts, src/ai/client.ts, src/editor/layout/EditorLayout.tsx)

**Target files**: `src/editor/prompt/CommandPalette.tsx`, `src/editor/prompt/ContextDisplay.tsx`

- Implement `ContextDisplay.tsx`:
  - Reads selection from store, builds a one-line summary: "{ComponentName} in {SequenceName}, frame {N}/{total}, {animation state}"
  - Renders as a pill with a blue-400 pulse dot when an element is selected
  - Shows "No element selected -- editing full file" when nothing is selected
- Implement `CommandPalette.tsx`:
  - Uses Radix UI Dialog for the modal + cmdk for the input
  - Triggered by `Cmd+K` (global keydown listener)
  - Layout: glass-modal scrim (bg-black/40 with backdrop-blur-sm), centered panel at 20vh from top, 580px wide
  - Content: ContextDisplay at top, text input for instruction, model selector toggle (Sonnet/Opus), submit button
  - On submit: calls `assembleMessages()` + `sendEditRequest()`, shows streaming indicator (shimmer dot + "Generating edit...")
  - On response complete: calls draft application flow, closes palette on success
  - On error: shows error inline in the palette, keeps it open for retry
  - `Escape` closes the palette and cancels any in-flight request
- Wire into `EditorLayout.tsx`

**Verification**:
- `Cmd+K` opens the command palette with glass-modal styling and blur scrim
- With an element selected, the context display shows correct element info
- Type an instruction and submit (requires valid API key) -- streaming indicator appears
- `Escape` closes the palette
- The palette animates in with the `glass-appear` animation (scale + translateY + opacity)
- `npm run typecheck` passes

### Task 4.2: TimelinePanel with Sequence visualization
`[x]` (src/editor/layout/TimelinePanel.tsx, src/editor/layout/EditorLayout.tsx)

**Target files**: `src/editor/layout/TimelinePanel.tsx`

- Replace the placeholder TimelinePanel:
  - Read temporal map from store
  - Render each Sequence as a horizontal bar: left position = `(from / totalFrames) * 100%`, width = `(duration / totalFrames) * 100%`
  - Nested Sequences stack vertically (child row below parent)
  - Color each Sequence distinctly (use a deterministic color from a palette based on index)
  - Show Sequence name as a label inside each bar (truncate if too narrow)
  - Render a red playhead line at the current frame position, with drag support:
    - `onMouseDown` starts drag, `onMouseMove` updates frame, `onMouseUp` ends drag
    - During drag, call `setCurrentFrame()` in store and seek the Player
  - Click on a Sequence bar selects it (sets selection to the Sequence's first child element)
  - Frame numbers along the top as a ruler
- Use `glass-well` for Sequence bars, `glass-tint-blue` for selected

**Verification**:
- Load multi-sequence sample -- Timeline shows 3 distinct Sequence bars at correct positions
- Drag the playhead -- the Player seeks to the dragged frame in real-time
- Load nested-components sample -- nested Sequences appear as stacked rows
- Click a Sequence bar -- selection updates to an element within that Sequence
- Timeline scrolls or scales if the composition is very long (basic overflow handling)

### Task 4.3: FileTreePanel for VFS browsing
`[x]` (src/editor/layout/FileTreePanel.tsx, src/editor/layout/EditorLayout.tsx, src/editor/layout/PreviewPanel.tsx, src/store.ts)

**Target files**: `src/editor/layout/FileTreePanel.tsx`

- Replace the placeholder FileTreePanel:
  - Read VFS file list from store
  - Render as a flat list of files (no directory nesting for MVP -- all files are at root of VFS)
  - Each file item shows: file icon (from Lucide), filename, compilation status indicator (green dot for success, red for error, amber for draft pending)
  - Click a file to set it as the active file in the store
  - Active file is highlighted with `glass-tint-blue`
  - Show a "New File" button at the bottom (creates a new empty file in VFS)
- Use the interactive element base pattern for hover/active/focus states

**Verification**:
- VFS with one file: FileTree shows it with correct name and green status dot
- Add a second file to VFS: it appears in the list
- Click a file: it becomes active (highlighted), PreviewPanel switches to render that file's composition
- File with compilation error shows red dot
- File with pending draft shows amber dot
- "New File" button creates an entry in VFS

### Task 4.4: historySlice and VersionHistory
`[x]` (src/store.ts, src/editor/history/VersionHistory.tsx, src/editor/layout/EditorLayout.tsx, src/ai/diff-parser.ts, src/editor/prompt/CommandPalette.tsx)

**Target files**: `src/store.ts` (extend with historySlice), `src/editor/history/VersionHistory.tsx`

- Add **historySlice** to the Zustand store:
  - State: `snapshots: Array<{ id: string, timestamp: number, description: string, vfsState: Map<string, VFSFile> }>`, `currentSnapshotIndex: number`
  - Actions: `pushSnapshot(description)` -- saves current VFS state, `restoreSnapshot(id)` -- restores VFS to a previous state and rebuilds temporal map, `undo()` -- restores the previous snapshot
  - Snapshots are created automatically when a draft is promoted (in the draft application flow from Task 3.4)
  - Cap at 50 snapshots, drop oldest when exceeded
- Implement `VersionHistory.tsx`:
  - Slide-in side sheet from right edge (overlaps Properties panel)
  - Toggle button in toolbar or keyboard shortcut (e.g., `Cmd+Shift+H`)
  - List of snapshots: timestamp (relative, e.g., "2 minutes ago"), description (from Claude's explanation), active indicator
  - Click a snapshot to restore it
  - Current snapshot highlighted
  - Uses `glass-modal` for the sheet, `glass-well` for snapshot items
  - Slide animation: `translate-x-full` to `translate-x-0` with `ease-glass` timing
- Wire `Cmd+Z` to call `undo()`

**Verification**:
- Make an edit via Claude -- a snapshot appears in version history
- Open version history panel -- it slides in from the right with animation
- Click a previous snapshot -- VFS restores, Player shows the old composition, temporal map rebuilds
- `Cmd+Z` undoes the last edit (restores previous snapshot)
- After 50+ edits, oldest snapshots are dropped (verify array length)
- `npm run typecheck` passes

### Task 4.5: Keyboard shortcuts and uiSlice
`[x]` (src/store.ts, src/editor/layout/EditorLayout.tsx, src/editor/prompt/CommandPalette.tsx, src/editor/layout/TimelinePanel.tsx)

**Target files**: `src/store.ts` (extend with uiSlice), `src/editor/layout/EditorLayout.tsx` (update)

- Add **uiSlice** to the Zustand store:
  - State: `commandPaletteOpen: boolean`, `versionHistoryOpen: boolean`, `fileTreeVisible: boolean`, `propertiesPanelVisible: boolean`, `timelineVisible: boolean`
  - Actions: `toggleCommandPalette()`, `toggleVersionHistory()`, `toggleFileTree()`, `togglePropertiesPanel()`, `toggleTimeline()`
- Implement a global keyboard shortcut handler in `EditorLayout.tsx`:
  - `Cmd+K` / `Ctrl+K`: toggle command palette
  - `E`: toggle edit mode (only when command palette is not open and no text input is focused)
  - `Space`: toggle play/pause (only when no text input is focused)
  - `Escape`: close command palette, clear selection, exit edit mode (in priority order)
  - `Cmd+Z` / `Ctrl+Z`: undo
  - `Cmd+Shift+H`: toggle version history
  - `1`: toggle file tree panel
  - `2`: toggle properties panel
  - `3`: toggle timeline panel
- Update `EditorLayout.tsx` grid to conditionally hide panels based on uiSlice visibility flags (set `grid-cols` dynamically)
- Add toolbar buttons for panel toggles with active state indicators

**Verification**:
- `Cmd+K` opens command palette, pressing again or `Escape` closes it
- `E` toggles edit mode (Player pauses on enter)
- `Space` toggles play/pause
- `Cmd+Z` undoes the last edit
- `1`, `2`, `3` toggle respective panels -- grid adjusts
- Shortcuts do not fire when typing in an input field
- `npm run typecheck` passes

---

## Phase 5: Video Generation + Export

**Goal**: A chat interface for generating initial compositions from scratch, a local render server for MP4 export, the CLI entry point, and multi-file composition support.

### Task 5.1: Generation chat interface
`[x]` (src/editor/generate/GenerateChat.tsx, src/ai/system-prompt.ts, src/ai/context-assembler.ts, src/store.ts, src/editor/layout/EditorLayout.tsx)

**Target files**: `src/editor/generate/GenerateChat.tsx`, `src/ai/system-prompt.ts` (extend)

- Create a chat interface for initial video generation (distinct from the edit command palette):
  - Full-height panel or modal where the user describes a video: "Create a 10-second product announcement with a title that bounces in, product image that scales up, and a CTA that fades in at the end"
  - Chat-style UI: user messages and Claude responses in a scrollable list
  - Claude generates a complete Remotion composition from scratch
  - On generation: load code into VFS, compile, preview in Player
  - The user can iterate via follow-up messages ("make the title bigger", "change the timing")
- Extend `system-prompt.ts` with generation-specific prompts:
  - Skill detection: analyze the user's request to determine the type of video (text animation, product showcase, social media content, data visualization)
  - Inject domain-specific guidance based on detected skill (following Remotion's AI code generation docs approach)
  - Generation prompt differs from edit prompt: no existing source code context, no temporal map, but includes composition defaults (1920x1080, 30fps, suggested duration)

**Verification**:
- Open the generate interface, type "Create a simple text animation that says Hello World"
- Claude generates a composition, it loads into VFS, compiles, and plays in the Player
- Follow-up messages modify the composition
- The generated code uses correct Remotion APIs (AbsoluteFill, useCurrentFrame, interpolate)
- `npm run typecheck` passes

### Task 5.2: Render server for MP4 export
`[x]` (server/render-server.ts, server/render-handler.ts, tsconfig.server.json, package.json)

**Target files**: `server/render-server.ts`, `server/render-handler.ts`

- Implement `render-server.ts`:
  - Express server on port 3001
  - `POST /api/render` endpoint: receives VFS contents, composition metadata (duration, fps, width, height, codec), and export settings
  - Input validation with zod schema
  - CORS configured to allow requests from `localhost:3000`
- Implement `render-handler.ts`:
  - Writes VFS files to a temp directory
  - Creates a Remotion entry point file that imports the composition
  - Calls `renderMedia()` from `@remotion/renderer` with the provided settings
  - Streams progress back to the client via Server-Sent Events (SSE) on `GET /api/render/:id/progress`
  - On completion, returns the file path for download via `GET /api/render/:id/download`
  - On error, returns structured error response
  - Cleans up temp directory after download or after 1 hour timeout
- Add `@remotion/renderer` and `express` to dependencies (these are Node.js-only, not bundled by Vite)

**Verification**:
- Start the render server: `node server/render-server.ts` (or via ts-node)
- `curl -X POST localhost:3001/api/render` with a valid VFS payload -- render starts
- SSE progress stream reports percentage (0-100)
- On completion, the MP4 file is downloadable
- Invalid input returns a 400 error with descriptive message
- `npm run typecheck` passes

### Task 5.3: CLI entry point
`[x]` (bin/motionlm.js, package.json)

**Target files**: `bin/motionlm.js`, `package.json` (update bin field)

- Create `bin/motionlm.js`:
  - Shebang: `#!/usr/bin/env node`
  - Starts the Vite dev server on port 3000 (using Vite's Node API or by spawning `npx vite`)
  - Starts the render server on port 3001 (by spawning or importing `server/render-server.ts`)
  - Opens the default browser to `http://localhost:3000`
  - Handles graceful shutdown: `SIGINT` and `SIGTERM` kill both child processes
  - Prints startup banner with version number and ports
- Update `package.json`:
  - Add `"bin": { "motionlm": "./bin/motionlm.js" }`
  - Add `"type": "module"` if not already set
  - Ensure `server/` files are included in the npm package

**Verification**:
- `node bin/motionlm.js` starts both servers and opens the browser
- The editor loads and is fully functional
- `Ctrl+C` cleanly shuts down both servers
- Export flow works end-to-end: make a composition, click export, MP4 renders

### Task 5.4: Multi-file composition support
`[x]` (src/engine/babel-plugins/vfs-import-transformer.ts, src/engine/compiler.ts, src/editor/layout/PreviewPanel.tsx)

**Target files**: `src/engine/compiler.ts` (extend)

- Extend the compiler to handle inter-file imports:
  - Parse import statements to build a dependency graph between VFS files
  - Topological sort: compile files in dependency order (leaves first)
  - Each compiled component is stored in a module registry
  - When compiling a file that imports from another VFS file, inject the already-compiled component via the `new Function()` constructor's scope
  - Handle circular dependency detection: return a clear error if detected
- Update the import-stripper plugin: strip external imports (react, remotion) but preserve inter-file VFS imports (transform them into registry lookups)
- Update VFS to support multiple files with a primary entry point marker

**Verification**:
- Create two files in VFS: `components.tsx` (defines a `Title` component) and `main.tsx` (imports and uses `Title`)
- Both compile successfully, `main.tsx` renders in the Player with the imported `Title` component
- Circular imports produce a clear error message
- Temporal map includes nodes from both files
- `npm run typecheck` passes

---

## Phase 6: Production Polish

**Goal**: Cloudflare Worker proxy, error boundaries, onboarding, performance optimization, and accessibility.

### Task 6.1: Cloudflare Worker proxy for Claude API
`[ ]`

**Target files**: `worker/proxy.ts`, `wrangler.toml`

- Implement a minimal Cloudflare Worker (~30 lines):
  - Accepts POST requests with `Authorization` header (user's API key, forwarded from browser)
  - Forwards to `https://api.anthropic.com/v1/messages` with the same body and headers
  - Streams the response back to the browser
  - CORS headers: allow the production domain and `localhost:3000`
  - No API key stored on the worker -- pure passthrough proxy
  - Rate limiting: 60 requests per minute per IP (using Cloudflare's built-in or a simple in-memory counter)
- Create `wrangler.toml` with worker configuration
- Update `src/ai/client.ts` to use the worker URL in production (read from settings or environment variable)

**Verification**:
- Deploy worker to Cloudflare (manual step, not automated)
- In production mode, Claude requests route through the worker and return correct responses
- CORS headers are present in the response
- Invalid requests return appropriate error codes
- In dev mode, the Vite proxy is still used (worker URL is only for production)

### Task 6.2: Error boundaries and onboarding flow
`[ ]`

**Target files**: `src/editor/ErrorBoundary.tsx`, `src/editor/onboarding/OnboardingFlow.tsx`, `src/editor/onboarding/ApiKeySetup.tsx`

- Implement `ErrorBoundary.tsx`:
  - React error boundary that catches render errors in any panel
  - Shows a `glass-tint-red` error card with: error message (human-readable, not raw stack), "Reload Panel" button, "Report Bug" link
  - Wraps each panel independently so one panel crashing does not take down the whole editor
  - Log errors to console with full stack for debugging
- Implement `OnboardingFlow.tsx`:
  - Shown on first visit (no API key in localStorage)
  - Step 1: Welcome screen with brief description of MotionLM
  - Step 2: `ApiKeySetup.tsx` -- input field for Anthropic API key with validation (format check + test API call), stored in settingsSlice (persisted to localStorage)
  - Step 3: Template chooser -- select from sample compositions or start with generation chat
  - Dismissible, re-accessible from settings
- Wrap all panels in `EditorLayout.tsx` with individual `ErrorBoundary` instances

**Verification**:
- First visit (clear localStorage): onboarding flow appears
- Enter a valid API key: it validates and persists
- Choose a template: it loads into VFS and renders
- Force a render error in a panel (e.g., throw in PropertiesPanel): error boundary catches it, other panels continue working
- "Reload Panel" button recovers the crashed panel
- `npm run typecheck` passes

### Task 6.3: Performance profiling and optimization
`[ ]`

**Target files**: `src/engine/temporal/parser.ts` (optimize), `src/engine/compiler.ts` (optimize), `src/App.tsx` (lazy loading)

- Profile temporal map parsing:
  - Add `performance.now()` instrumentation around `parseTemporalMap()`
  - Test with the complex-timeline sample (should be < 200ms)
  - If over target: memoize AST traversal results, consider incremental parsing (only re-parse changed regions)
- Profile Babel compilation:
  - Measure `Babel.transform()` time and `new Function()` construction time separately
  - If Babel loading is slow on initial page load: lazy-load `@babel/standalone` (dynamic import, show a loading indicator)
- React rendering optimization:
  - Add `React.memo()` to panels that re-render unnecessarily
  - Use Zustand selectors to prevent store-triggered re-renders in components that do not depend on the changed slice
  - Profile with React DevTools Profiler
- Bundle size audit:
  - Run `npx vite-bundle-visualizer` to identify large dependencies
  - Lazy-load heavy components (CommandPalette, VersionHistory, GenerateChat) with `React.lazy()` + `Suspense`

**Verification**:
- Temporal map parsing for all 5 samples completes in < 200ms each (log times to console)
- Babel loads lazily: initial page load does not block on @babel/standalone download
- No unnecessary re-renders when typing in the command palette (verify with React Profiler)
- Bundle size of main chunk is reasonable (target < 500KB gzipped excluding @babel/standalone)

### Task 6.4: Responsive layout and accessibility audit
`[ ]`

**Target files**: `src/editor/layout/EditorLayout.tsx` (update), multiple component files

- Responsive layout:
  - Minimum supported width: 1280px
  - At < 1280px: auto-collapse FileTree and Properties panels, show toggle buttons
  - At < 1024px: show a "Desktop only" message (editor is not usable on mobile)
  - Panel resize handles (optional, stretch goal): draggable borders between panels
- Accessibility audit:
  - All interactive elements have `focus-visible` ring styling (already in the base pattern)
  - Command palette: proper `aria-label` on input, `role="dialog"` via Radix, `aria-selected` on results via cmdk
  - Timeline: `aria-label` on Sequence bars, keyboard navigation (arrow keys to move between Sequences)
  - FileTree: `role="listbox"` or `role="tree"`, arrow key navigation
  - Screen reader announcements for: edit applied, compilation error, undo
  - Color contrast: verify all text passes WCAG AA (4.5:1) against glass backgrounds (already specified in design system)
  - `prefers-reduced-motion`: animations disabled (already in Task 0.2)
- Keyboard navigation: Tab order follows logical flow (FileTree -> Preview -> Properties -> Timeline)

**Verification**:
- At 1280px width: all panels visible, layout is usable
- At 1100px width: FileTree and Properties auto-collapse
- At 900px width: "Desktop only" message appears
- Tab through the interface: focus moves in logical order with visible focus rings
- Screen reader (VoiceOver on macOS): can navigate all panels and hear relevant announcements
- All text passes WCAG AA contrast check against their backgrounds
- `npm run typecheck` passes

---

## Dependency Graph

```
0.1 (scaffold)
 |
 +-- 0.2 (design tokens)
 |    |
 +----+-- 0.3 (store)
 |         |
 +----+----+-- 0.4 (compiler)
 |              |
 +---------+---+-- 0.5 (editor shell + Player)
                |
                +-- 1.1 (temporal types + samples)
                |    |
                |    +-- 1.2 (AST parser)
                |    |    |
                |    |    +-- 1.3 (frame tracing)
                |    |         |
                |    +---------+-- 1.4 (temporalSlice + tests)
                |                   |
                +-------------------+-- 2.1 (source-map plugin)
                                    |    |
                                    |    +-- 2.2 (overlay + hover)
                                    |         |
                                    |         +-- 2.3 (click-to-select)
                                    |              |
                                    |              +-- 2.4 (PropertiesPanel)
                                    |                   |
                                    +-------------------+-- 3.1 (Claude client)
                                                        |    |
                                                        |    +-- 3.2 (system prompt)
                                                        |    |
                                                        |    +-- 3.3 (context assembler)
                                                        |         |
                                                        +---------+-- 3.4 (draft flow)
                                                                       |
                                    +----------------------------------+
                                    |
                                    +-- 4.1 (CommandPalette)
                                    +-- 4.2 (Timeline)
                                    +-- 4.3 (FileTree)
                                    +-- 4.4 (historySlice + VersionHistory)
                                    +-- 4.5 (shortcuts + uiSlice)
                                    |
                                    +-- 5.1 (generation chat)
                                    +-- 5.2 (render server)
                                    +-- 5.3 (CLI) -- depends on 5.2
                                    +-- 5.4 (multi-file compiler)
                                    |
                                    +-- 6.1 (Cloudflare proxy)
                                    +-- 6.2 (error boundaries + onboarding)
                                    +-- 6.3 (performance)
                                    +-- 6.4 (responsive + a11y)
```

Tasks within Phase 4 (4.1-4.5) can be worked in parallel. Tasks within Phase 5 and Phase 6 are also mostly parallelizable.

---

## Revisions

| Date | Change | Reason |
|------|--------|--------|
| 2026-03-17 | Initial plan created | Granular task breakdown from architecture critique |
| 2026-03-31 | Add persistence layer (IndexedDB auto-save + File System Access API) | VFS lost on every browser refresh — editor needs to survive page reloads to be usable. See `Plans/persistence-plan.md`. Files: `src/persistence/idb.ts`, `src/persistence/filesystem.ts`, `src/App.tsx`, `src/store.ts`, `src/editor/layout/PreviewPanel.tsx`, `src/editor/layout/FileTreePanel.tsx`, `src/editor/layout/EditorLayout.tsx` |
| -- | Moved Liquid Glass design tokens to Task 0.2 | Original plan deferred design system setup; causes inconsistent styling in early phases |
| -- | Incremental store slices across phases | Building all 7 slices in Phase 0 is premature; slices should land with their backing logic |
| -- | Added minimal editor shell to Phase 0 (Task 0.5) | Phases 1-3 need a visual surface for testing |
| -- | Added zod to dependency list | Required by CLAUDE.md rules for API boundary validation, was missing from original plan |
| -- | Tailwind v4 CSS-first config in index.css | Original plan used tailwind.config.ts for tokens; v4 uses @theme directives in CSS |
