# MotionLM — Agentic Transformation Plan

Transform MotionLM from a tool-with-AI-features into a truly agentic AI collaborator. The user should feel they are working alongside an AI artist who can plan, remember, see, suggest, and iterate autonomously.

Full architecture rationale: `Plans/agentic-transformation-plan.md`
Previous plan (phases 0-5, completed): `Plans/phase-0-5-plan.md`

---

## Status Protocol

- `[ ]` Todo
- `[/]` In Progress
- `[x]` Done
- `[!]` Blocked

---

## Phase A: Agent Core + Prompt Caching + Chat UI (3 weeks)

The foundation everything else builds on. Single agent loop with tool_use API, prompt caching, and a persistent chat panel (feature-flagged alongside existing UI).

### Task A.1: Agent type definitions
`[x]` (src/agent/types.ts)

**Target files**: `src/agent/types.ts`

- Define `AgentState` enum: `IDLE`, `THINKING`, `TOOL_CALL`, `COMPLETE`, `ERROR`, `PAUSED`
- Define `AgentAction` discriminated union (text_delta, tool_call_start, tool_call_result, state_change, error)
- Define `AgentMessage` type (role, content blocks including text, tool_use, tool_result, image)
- Define `TokenUsage` type: `{ input: number, output: number, cached: number }`
- TypeScript strict, no `any`, named exports only

**Verification**: `npm run typecheck` passes

### Task A.2: Tool system types and core tools
`[x]` (src/agent/tools/types.ts, think.ts, edit-file.ts, read-file.ts, list-files.ts, create-file.ts, check-compilation.ts, seek-to-frame.ts, get-temporal-map.ts, get-element-info.ts, index.ts)

**Target files**: `src/agent/tools/types.ts`, `src/agent/tools/think.ts`, `src/agent/tools/edit-file.ts`, `src/agent/tools/read-file.ts`, `src/agent/tools/list-files.ts`, `src/agent/tools/create-file.ts`, `src/agent/tools/check-compilation.ts`, `src/agent/tools/seek-to-frame.ts`, `src/agent/tools/get-temporal-map.ts`, `src/agent/tools/get-element-info.ts`, `src/agent/tools/index.ts`

- `AgentTool` interface: `{ name, description, input_schema, execute }`
- `ToolResult` type: `{ type: "text", text } | { type: "image", media_type, data }`
- Each tool: name, description, JSON Schema for input, execute function that interacts with Zustand store
- `think` tool: accepts `{ thought: string }`, stores in agentSlice, returns "ok"
- `edit_file` tool: writes to draftCode, compiles, promotes on success, returns compilation result
- `check_compilation` tool: dry-run compile without promoting
- Tool registry export from `index.ts`

**Verification**: `npm run typecheck` passes. Tools can be imported and their schemas validated.

### Task A.3: Agent runner (tool-calling loop)
`[x]` (src/agent/runner.ts)

**Target files**: `src/agent/runner.ts`

- Async generator: takes `(messages, tools, apiKey, model, abortSignal)`, yields `AgentAction` events
- Handles streaming response with tool_use content blocks
- On tool_use: execute tool, append tool_result, loop back to Claude
- On text only: yield text_delta events, return
- Circuit breakers: max 25 tool calls per user message, abort signal support
- Track token usage from response headers/usage field
- ~150 lines

**Verification**: `npm run typecheck` passes

### Task A.4: Agent store slice
`[x]` (src/store.ts — agentSlice added)

**Target files**: `src/store.ts`

- Add `agentSlice` to the composed store
- State: `agentState`, `conversationHistory: AgentMessage[]`, `activeSessionId`, `pendingToolCalls`, `tokenUsage`, `iterationCount`, `thinkLog: string[]`, `useAgentChat: boolean` (feature flag)
- Actions: `setAgentState`, `appendMessage`, `setTokenUsage`, `incrementIteration`, `resetSession`, `appendThinkLog`, `toggleAgentChat`
- Single `set()` call for cross-slice updates per CLAUDE.md rules

**Verification**: `npm run typecheck` passes. Store can be imported and actions called.

### Task A.5: Extend API client for tool_use + streaming
`[x]` (src/ai/client.ts — sendAgentRequest, AgentStreamEvent, AgentRequestMessage, ToolDefinition, SystemBlock; src/agent/runner.ts — refactored to use sendAgentRequest)

**Target files**: `src/ai/client.ts`

- Extend `SseEventSchema` to handle: `content_block_start` with `type: "tool_use"`, `input_json_delta`, `content_block_stop`
- New `sendAgentRequest()` function: accepts messages with content blocks (text, tool_use, tool_result, image), tool definitions, cache_control annotations
- Stream handler yields structured events (not just text deltas): `text_delta`, `tool_use_start`, `tool_input_delta`, `tool_use_end`, `message_stop`
- Support `cache_control: { type: "ephemeral" }` on system prompt content blocks

**Verification**: `npm run typecheck` passes

### Task A.6: Prompt caching manager
`[x]` (src/agent/cache-manager.ts)

**Target files**: `src/agent/cache-manager.ts`

- Manages `cache_control` breakpoint placement on messages
- System prompt + tools always get a breakpoint (most stable content)
- Rotating breakpoint on last assistant message in conversation history
- Coordinates with profile store: only propagate profile updates to system prompt at session start or every 10th accepted edit (avoids cache invalidation trap)
- Track cache hit/miss in token usage

**Verification**: `npm run typecheck` passes

### Task A.7: System prompt rewrite
`[x]` (src/ai/system-prompt.ts — buildAgentSystemPrompt added; legacy exports preserved)

**Target files**: `src/ai/system-prompt.ts`

- New system prompt with: Remotion API reference (keep existing), editing rules, plan-then-execute instructions ("think through steps before acting"), tool usage guidance
- Placeholder for `<user-style-profile>` injection
- Export function `buildSystemPrompt(profile?: UserStyleProfile): ContentBlock[]` that returns content blocks with cache_control on the last block

**Verification**: `npm run typecheck` passes

### Task A.8: Unified context builder
`[x]` (src/agent/context.ts — buildAgentUserMessage, buildFollowUpUserMessage)

**Target files**: `src/agent/context.ts`

- Replaces separate `assembleEditContext` and `assembleGenerationMessages` in `src/ai/context-assembler.ts`
- Always includes: all VFS files (or active file + imports), temporal map for active file, selected element + frame narrative if any
- Outputs structured content blocks for the user message
- Keep old context-assembler working (don't delete -- both UIs run during transition)

**Verification**: `npm run typecheck` passes

### Task A.9: Agent session manager
`[x]` (src/agent/session.ts — AgentSession class)

**Target files**: `src/agent/session.ts`

- `AgentSession` class tying together runner, cache manager, context builder, and store
- `send(userMessage, selectionContext?)`: assembles full message array, runs agent loop, dispatches actions to store
- Handles abort (user presses Escape), error recovery, PAUSED state
- Manages conversation history append

**Verification**: `npm run typecheck` passes

### Task A.10: AgentChat UI panel
`[x]` (src/editor/chat/AgentChat.tsx, MessageList.tsx, ToolCallCard.tsx, ContextPill.tsx, ThinkingIndicator.tsx)

**Target files**: `src/editor/chat/AgentChat.tsx`, `src/editor/chat/MessageList.tsx`, `src/editor/chat/ToolCallCard.tsx`, `src/editor/chat/ContextPill.tsx`, `src/editor/chat/ThinkingIndicator.tsx`

- `AgentChat.tsx`: persistent right-side panel, resizable, collapsible. Text input at bottom, message list above, token usage counter in header. Abort button visible during agent execution.
- `MessageList.tsx`: renders AgentMessages -- user text, agent text (streamed), tool call cards, images
- `ToolCallCard.tsx`: collapsible card per tool call. Shows tool name, input summary, output. Code diffs for edit_file, images for capture_frame.
- `ContextPill.tsx`: shows `[@ElementName:frameN]` when element selected. Appears in the input area.
- `ThinkingIndicator.tsx`: pulsing indicator during agent execution. Shows current tool name. Clickable to expand read-only "Agent Reasoning" view of think log (collapsed by default).
- Tailwind v4, Radix primitives, Lucide icons. No inline styles.

**Verification**: Component renders without errors. Feature flag toggles visibility.

### Task A.11: Wire AgentChat into EditorLayout
`[x]` (src/editor/layout/EditorLayout.tsx — AgentChat panel, Cmd+K routing, Agent toolbar button)

**Target files**: `src/editor/layout/EditorLayout.tsx`

- Add AgentChat as right panel, gated on `useAgentChat` feature flag from settingsSlice
- Cmd+K focuses chat input when flag is enabled (old CommandPalette still works when flag is off)
- Layout: `[FileTree] [Preview + Timeline] [ChatPanel]` when enabled
- Graceful degradation: chat input disabled without API key, shows setup prompt

**Verification**: Toggle feature flag -> AgentChat appears/disappears. Old CommandPalette still works when flag is off. No API key -> chat shows setup message. Manual editor (preview, timeline, file tree, export) works regardless.

### Task A.12: End-to-end integration test
`[ ]`

- Set API key, enable feature flag
- Type "create a simple text animation" in chat -> agent calls think, create_file, edit_file, check_compilation -> tool cards appear in chat -> preview updates with new composition
- Click element in preview -> context pill shows in chat input -> type "make it red" -> agent calls edit_file -> preview updates
- If compilation fails -> agent sees error in tool result -> retries automatically
- Trigger circuit breaker (rapid requests) -> agent pauses, shows progress
- Token counter updates after each turn
- Abort mid-execution with Escape -> agent stops, shows partial progress

---

## Phase B: Visual Grounding + Web Worker (2 weeks)
Depends on Phase A.

### Task B.1: POST /api/render/still endpoint
`[x]` (server/render-handler.ts, server/render-server.ts)
**Target files**: `server/render-server.ts`, `server/render-handler.ts`
- Accepts `{ files, compositionId, frame, width?, height? }`, validates with zod
- Uses `renderStill()` from `@remotion/renderer`
- Returns PNG as base64 string
- Default resolution: 854x480
- Handles errors gracefully, never exposes raw stack traces

### Task B.2: capture_frame tool
`[x]` (src/agent/tools/capture-frame.ts, src/agent/tools/index.ts)
**Target files**: `src/agent/tools/capture-frame.ts`, `src/agent/tools/index.ts`
- Calls `POST /api/render/still` with current VFS files and frame
- Gets compositionId from store or defaults to "Main"
- Returns `ToolResult { type: "image", media_type: "image/png", data: base64 }`
- Falls back to text error if render server unreachable
- Registered in ALL_TOOLS

### Task B.3: capture_sequence tool
`[x]` (src/agent/tools/capture-sequence.ts, src/agent/tools/index.ts)
**Target files**: `src/agent/tools/capture-sequence.ts`, `src/agent/tools/index.ts`
- Accepts `{ frames: number[], label?: string }`
- Renders up to 4 frames, stitches into 2x2 filmstrip via OffscreenCanvas
- Returns single image ToolResult
- Registered in ALL_TOOLS

### Task B.4: compiler.worker.ts
`[x]` (src/engine/compiler.worker.ts)
**Target files**: `src/engine/compiler.worker.ts`
- Receives `{ type: "compile", requestId, entryPath, files }`
- Runs Babel transform for all files (dep graph, topo sort, transform)
- Posts back `{ transformedSources, compilationOrder }` or `{ error }`
- Babel transform is the slow step (~50ms); worker moves it off main thread

### Task B.5: compiler-bridge.ts
`[x]` (src/engine/compiler-bridge.ts)
**Target files**: `src/engine/compiler-bridge.ts`
- Exports `compileAsync(entryPath, files): Promise<CompileResult>`
- Manages single persistent Worker instance
- Pending-map pattern for request/response round-trip
- Runs `new Function()` on main thread from worker's transformed sources
- Falls back to synchronous `compileWithVFS()` if Worker unavailable

### Task B.6: Migrate PreviewPanel to async compilation
`[x]` (src/editor/layout/PreviewPanel.tsx)
**Target files**: `src/editor/layout/PreviewPanel.tsx`
- Replace synchronous `compileWithVFS()` call with `compileAsync()` from bridge
- Compilation status flow unchanged: draftCode → compiling → success/error → promote/discard

### Task B.2.1: Image content block end-to-end flow
`[x]` (src/agent/types.ts, src/agent/runner.ts, src/agent/session.ts, src/editor/chat/ToolCallCard.tsx)

### Task B.2.2: Verify capture tools in ALL_TOOLS
`[x]` (src/agent/tools/index.ts — confirmed from Session 1)

### Task B.2.3: Visual grounding instructions in system prompt
`[x]` (src/ai/system-prompt.ts)

### Task B.2.4: Compiler bridge timeout
`[x]` (src/engine/compiler-bridge.ts)

See `Plans/agentic-transformation-plan.md` sections 4 and 8.

---

## Phase C: Memory Layer (2 weeks)
Depends on Phase A.

`[ ]` Tasks to be detailed when Phase A is complete.

Key deliverables:
- IndexedDB stores: conversations, userProfile, editJournal
- Style extractor, profile store, edit journal
- Session persistence and restoration
- User profile injection into system prompt (batched updates for cache preservation)

See `Plans/agentic-transformation-plan.md` section 6.

---

## Phase D: Proactive Intelligence + Ghost Tracks (1-2 weeks)
Depends on Phases A + B + C.

`[ ]` Tasks to be detailed when Phase C is complete.

Key deliverables:
- Post-edit analyzer, style checker, idle-time suggestions
- Ghost track generator for timeline
- Suggestion rendering in AgentChat with before/after frame captures
- Ghost track rendering on TimelinePanel with inline accept/reject

See `Plans/agentic-transformation-plan.md` sections 7 and 7d.

---

## Phase E: UI Migration + Director Inputs + External Integration (3 weeks)
Depends on Phases A + B.

`[ ]` Tasks to be detailed when Phase D is complete.

Key deliverables:
- Remove feature flag, AgentChat becomes default
- Remove old CommandPalette and GenerateChat
- Spatial directives: draw motion paths on overlay
- Voice-to-action: spacebar-hold-to-talk with frame context
- Asset sourcing: fetch_external_asset tool + server route
- Reference image analysis via Claude vision
- Flexible model registry

See `Plans/agentic-transformation-plan.md` sections 10 and 11.

---

## Phase F: Advanced Features (ongoing)
Depends on all previous phases.

`[ ]` Tasks to be detailed as needed.

Key deliverables:
- MCP server wrapper for external tool access
- In-browser semantic search via Transformers.js WASM
- Nemotron/OpenAI-compatible model support
- Collaborative editing features

See `Plans/agentic-transformation-plan.md` section 14 Phase F.
