# MotionLM Agentic Transformation Plan (v2)

## Context

MotionLM today is a capable AI-assisted video editor, but it operates as a **tool with AI features** rather than an **AI collaborator**. The user must issue discrete commands (Cmd+K for element edits, separate chat panel for generation), each interaction is stateless, Claude never sees the visual output, and there is no memory, planning, or proactive behavior. The goal of this plan is to transform MotionLM into a truly agentic experience where the user feels they are working alongside an AI artist who can plan, remember, see, suggest, and iterate autonomously.

This v2 incorporates validated improvements from external review and our own critique of v1. Changes from v1 are marked with **[v2]**.

---

## 1. Agentic Core: The Agent Loop

**Problem:** Two disconnected AI paths (single-turn element edits via `useEditStream.ts`, multi-turn chat via `GenerateChat.tsx`). Claude responds once and is done. No tool calling, no self-correction loop, no autonomous multi-step execution.

**Solution:** Replace both paths with a single **agent loop** that uses Anthropic's native tool_use API.

**Architecture:**

```
User Message
    |
    v
AgentSession (src/agent/session.ts)
    |
    v
Claude API (with tool definitions + prompt caching)
    |
    +---> tool_use block? ---> Execute tool ---> Feed result back ---> Loop
    |
    +---> text only? ---> Stream to user ---> IDLE
    |
    +---> Circuit breaker hit? ---> Pause, ask user to continue ---> IDLE or Loop
```

**State machine:** `IDLE -> THINKING -> (TOOL_CALL | CODE_EDIT | COMPLETE | ERROR | PAUSED) -> THINKING -> ...`

**New files:**
- `src/agent/types.ts` -- AgentState, AgentAction, AgentTool, AgentMessage type definitions
- `src/agent/runner.ts` -- Async generator that runs the tool-calling loop (~150 lines). Takes `(messages, tools, apiKey, model)`, yields `AgentAction` events for UI subscription
- `src/agent/session.ts` -- Manages conversation lifecycle, dispatches tool calls, tracks state transitions
- `src/agent/tools/` -- Tool implementations (see section 3)

**Store changes:**
- New `agentSlice` in `src/store.ts`: `agentState`, `conversationHistory: AgentMessage[]`, `activeSessionId`, `pendingToolCalls`, `tokenUsage: { input, output, cached }`, `iterationCount`

**Key decisions:**
- Single agent with rich tool access, not multi-agent orchestration. The "planner" is a system prompt section instructing Claude to think through steps before acting. The "evaluator" is a tool Claude can call (`check_compilation`, `capture_frame`). This avoids the latency and complexity of multi-agent routing while achieving the same behavioral outcome.
- **[v2] Circuit breakers:** Max 25 tool calls per user message. Token budget tracking per session (warn at 80% of user-configured limit). User-initiated abort button visible during agent execution. If the agent hits the iteration limit, it pauses and presents its progress so far, asking the user whether to continue.
- **[v2] PAUSED state:** When circuit breakers trigger or the agent is uncertain, it enters PAUSED and surfaces a question to the user rather than guessing.

**Files to modify:** `src/store.ts`, `src/ai/client.ts` (extend for tool_use content blocks and streaming tool call events)

---

## 2. Prompt Caching in the Agent Loop **[v2 -- new section]**

**Problem:** In an agent loop, context grows with every tool call. Without caching, every LLM request reprocesses the entire conversation from scratch. By the 10th turn, you're sending 80K+ tokens per request -- massive API bills and multi-second latency.

**Solution:** Anthropic prompt caching with `cache_control` breakpoints.

**How it works:**
- Place `cache_control: { type: "ephemeral" }` on the system prompt (most stable content -- tool definitions, Remotion API reference, user style profile)
- Place a second breakpoint at the end of the last assistant message in the conversation history
- On each new turn, remove the old conversation breakpoint and add a new one after the latest response
- Claude reads the cached prefix at **90% discount** (0.1x base price) and only pays full price for the new portion

**Implementation:**
- `src/agent/cache-manager.ts` -- Manages breakpoint placement. Ensures system prompt + tools always have a breakpoint. Rotates conversation breakpoints as history grows.
- Modify `src/ai/client.ts` to accept `cache_control` annotations on message content blocks
- Track cache hit/miss rates in `agentSlice.tokenUsage` for user visibility

**Constraints:**
- Minimum cacheable prefix: 1,024 tokens (our system prompt + tools easily exceeds this)
- Max 4 breakpoints per request
- 5-minute TTL (refreshed on each hit) -- sufficient for active editing sessions
- Cache invalidated if tool definitions change (avoid dynamic tool list modifications mid-session)
- **[v3] Cache invalidation trap:** Anything before a breakpoint that changes will invalidate the cache and trigger a 1.25x write surcharge instead of a 0.1x read. The user style profile (section 6) lives in the system prompt before the first breakpoint. If it updates after every accepted edit, every subsequent turn is a cache miss. **Fix:** Batch profile updates -- only inject a refreshed profile at session start or after every 10th accepted edit. Between batches, the profile is frozen in the system prompt, keeping the cache warm. The `cache-manager.ts` must coordinate with `profile-store.ts` to gate when profile changes propagate to the system prompt.

**ROI:** ~68% cost reduction on typical agentic sessions. Sub-second latency on cache hits for follow-up turns.

---

## 3. Tool System

**Problem:** Claude outputs a monolithic JSON `{ file, code, explanation }`. It can't render previews, analyze the timeline, check compilation, or manage files. The `MAX_RETRIES = 2` loop is a poor substitute for agentic self-correction.

**Solution:** Define tools using Anthropic's native tool_use format. Each tool is a typed function with JSON Schema and an execute handler.

**Tool registry (`src/agent/tools/`):**

| Tool | File | What it does |
|------|------|-------------|
| `think` | `think.ts` | **[v2]** Internal reasoning scratchpad. Claude uses this to plan complex edits without generating user-visible text. Zero-cost tool (returns "ok"). **[v3]** Think output stored in `agentSlice` and viewable via expandable "Agent Reasoning" panel in ThinkingIndicator. |
| `edit_file` | `edit-file.ts` | Write code to VFS file, triggers draft/compile/promote. Returns compilation result. |
| `read_file` | `read-file.ts` | Read any VFS file contents. |
| `list_files` | `list-files.ts` | List all files in VFS. |
| `create_file` | `create-file.ts` | Create new VFS file. |
| `get_temporal_map` | `get-temporal-map.ts` | Returns temporal map -- all elements, frame ranges, animations. |
| `get_element_info` | `get-element-info.ts` | Detailed element info at a specific frame. |
| `check_compilation` | `check-compilation.ts` | Dry-run compile without promoting. Returns success/error. |
| `capture_frame` | `capture-frame.ts` | **[v2]** Renders a still frame via render server's `renderStill()` endpoint. Returns image. |
| `capture_sequence` | `capture-sequence.ts` | **[v2]** Renders multiple frames as a filmstrip via render server. |
| `render_preview` | `render-preview.ts` | Trigger short GIF render via render server. |
| `seek_to_frame` | `seek-to-frame.ts` | Move playhead to specific frame. |
| `get_user_profile` | `get-user-profile.ts` | Read user's style preferences from memory. |
| `fetch_external_asset` | `fetch-asset.ts` | **[v3]** Search and download images (Unsplash/Pexels) or royalty-free audio. Saves to VFS. Returns file path for use in composition. |

**Tool definition type:**
```typescript
// src/agent/tools/types.ts
export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (input: unknown) => Promise<ToolResult>;
}

export type ToolResult =
  | { type: "text"; text: string }
  | { type: "image"; media_type: "image/png"; data: string };
```

**Key decisions:**
- Tools run in-browser (except `capture_frame`, `capture_sequence`, and `render_preview` which hit the Express render server). Tool definitions follow MCP schema format so wrapping them as an MCP server later is trivial.
- **[v2] `think` tool:** Replaces extended thinking for tool-use scenarios. Claude can reason between complex tool calls without generating user-visible text. Based on Anthropic's recommended pattern for sequential tool chains.
- **How `edit_file` replaces current flow:** Claude calls `edit_file` with code -> tool runs compilation -> returns result. If compilation fails, Claude sees the error and retries within the same turn. Natural agent retry replaces the hardcoded `MAX_RETRIES = 2`.
- Claude can invoke multiple tools in a single response (parallel tool calling). The runner executes all parallel calls and returns results together.

---

## 4. Visual Grounding Pipeline

**Problem:** Claude never sees what it creates. It receives source code + temporal map + text narrative. It cannot verify visual results or catch visual bugs.

**[v2] Revised approach:** Use Remotion's native `renderStill()` via the render server instead of `html-to-image`.

**Why not html-to-image:**
- Remotion Player renders DOM/CSS-based React components, but may use iframe isolation or custom rendering contexts internally
- `html-to-image` uses SVG `<foreignObject>` serialization which is fragile with complex CSS transforms and animation state
- `renderStill()` is Remotion's own pixel-perfect frame renderer -- reliable by design

**Implementation:**

### New render server endpoint
- `POST /api/render/still` in `server/render-server.ts` (~20 lines)
- Accepts: `{ files: VFSContents, compositionId: string, frame: number, width?: number, height?: number }`
- Returns: PNG base64 string
- Uses `@remotion/renderer`'s `renderStill()` which is already available as a dependency
- Captures at reduced resolution (480p) by default to keep response size small (~50-100KB)

### Agent tools
- `src/agent/tools/capture-frame.ts` -- Calls `POST /api/render/still` with current VFS + target frame. Returns image content block.
- `src/agent/tools/capture-sequence.ts` -- Calls the still endpoint for multiple frames (e.g., every 30 frames), composites into a filmstrip image.

### Agent runner changes
- Agent runner inserts image content blocks into the next Claude message when a capture tool returns
- System prompt instructs agent to capture frames after significant visual edits

**Tradeoffs:**
- Latency: `renderStill()` takes ~500ms-1s per frame (vs ~200ms for DOM capture). Acceptable for verification, not for real-time preview.
- Reliability: Pixel-perfect, no DOM serialization bugs.
- Works even when the browser Player is not visible (headless render).

**[v2] Ghost Previews for Proactive Suggestions:**
When the agent suggests a proactive change (section 6), use `renderStill()` to capture before/after frames. Display as an image pair in the suggestion card so the user sees the proposed change visually before clicking "Apply."

---

## 5. Unified Conversation Model

**Problem:** CommandPalette (Cmd+K) and GenerateChat are completely separate. No shared conversation state. Element edits have no memory. Generation can't target specific elements.

**Solution:** Merge into a single persistent chat panel. The agent always has full context (selected element, current frame, entire VFS, temporal map). Same conversation flows from "generate a video" to "make that title bounce" to "render a preview."

**New files:**
- `src/editor/chat/AgentChat.tsx` -- Persistent right-side panel
- `src/editor/chat/MessageList.tsx` -- Renders messages, tool call cards, diffs, screenshots
- `src/editor/chat/ToolCallCard.tsx` -- Collapsible card showing tool name, input, output (diff view for edits, image for captures)
- `src/editor/chat/ContextPill.tsx` -- Shows `[@Title:frame45]` when element is selected
- `src/editor/chat/ThinkingIndicator.tsx` -- **[v2]** Animated indicator when agent is processing, shows which tool is executing. **[v3]** Clickable to expand a read-only "Agent Reasoning" view showing the `think` tool's raw output. Collapsed by default so it doesn't clutter the UI, but available for users who want to see the agent's internal logic (e.g., "The Sequence is only 15 frames, I need to extend duration before adding the bounce"). Builds trust by making the agent's decision-making transparent.
- `src/agent/context.ts` -- Unified context builder replacing separate `assembleEditContext` and `assembleGenerationMessages`

**UI flow:**
1. User clicks element in preview -- context pill appears in chat input
2. User types instruction -- agent receives full context (VFS + temporal map + element selection + user profile)
3. Agent plans steps, executes tools, shows progress as collapsible cards in chat
4. **[v2]** Text streams in real-time as Claude generates it. Tool calls appear as animated cards that expand when results arrive.
5. Cmd+K focuses the chat input (replaces modal command palette)
6. **[v2]** Abort button visible during agent execution. Pressing it or hitting Escape stops the agent loop and enters PAUSED state.

**Layout change:** `[FileTree] [Preview + Timeline] [ChatPanel]`
- Chat panel subsumes Properties panel (element info shown as "context tab" in chat)
- Remove edit mode toggle -- selection is always active

**[v2] Migration strategy:**
- Phase A builds AgentChat alongside existing CommandPalette and GenerateChat
- Both old and new UIs work during transition (feature flag in settingsSlice)
- Phase E removes old components after AgentChat is validated
- This avoids breaking the app during development

**Files to modify:** `src/editor/layout/EditorLayout.tsx` (restructure panels), `src/ai/context-assembler.ts` (refactor into unified builder)

---

## 6. Memory and Personalization

**Problem:** No memory across sessions. No style learning. Each interaction starts fresh. The user must re-explain preferences every time.

**Solution:** Three memory layers, all in IndexedDB (no external services).

### Layer 1: Session Memory
- Conversation history persisted per session
- Extend `src/persistence/idb.ts` with `conversations` store: `{ sessionId, messages[], createdAt, lastActiveAt }`
- `agentSlice` loads latest session on hydration

### Layer 2: User Style Profile
- After each accepted edit, extract style signals: colors, easing prefs, fonts, durations, spring configs
- `src/agent/memory/style-extractor.ts` -- Pure function analyzing accepted code diffs
- `src/agent/memory/profile-store.ts` -- CRUD for user profile in IDB
- Inject `<user-style-profile>` section into system prompt. **[v3]** Profile updates are batched (session-start or every 10th accepted edit) to avoid invalidating the prompt cache on every turn -- see section 2 cache invalidation trap.

### Layer 3: Edit Journal
- Semantic log beyond VFS snapshots: `{ editId, instruction, elementTargeted, wasAccepted, compilationAttempts, errorTypes }`
- `src/agent/memory/edit-journal.ts` -- Append-only log
- Enables "you previously used spring({stiffness: 200}) on this element -- want the same config?" reasoning
- **[v2]** Retrieval via keyword matching + recency weighting. Simple but effective for <1000 entries. Semantic search via in-browser embeddings deferred to Phase F.

**Key decision:** Structured profile injected verbatim into system prompt, not vector embedding/retrieval. Profile is <10KB. Simpler, more predictable, captures 80% of the value. No Mem0 or external memory service needed.

---

## 7. Proactive Intelligence

**Problem:** The system is entirely reactive. No suggestions, no warnings, no style consistency checks.

**Solution:** Three categories of proactive behavior, all running locally (no Claude calls).

### 7a. Post-Edit Analysis
- `src/agent/proactive/post-edit-analyzer.ts` -- After each edit, checks for: animation clamping issues, element overlap at certain frames, excessive spring oscillation, text cutoff at boundaries
- Surfaces as dismissible suggestions in chat
- **[v2]** Suggestions include before/after frame captures via `renderStill()` so the user can see the proposed fix visually

### 7b. Style Consistency
- `src/agent/proactive/style-checker.ts` -- Compares new edits against user's style profile
- Example: "You typically use easeOut for entrances, but this uses linear. Match your style?"

### 7c. Idle-Time Suggestions
- `src/agent/proactive/idle-suggestions.ts` -- When user pauses >10s, analyzes composition via temporal map
- "This composition has no exit animations. Add fade-outs?" or "Timing feels rushed -- extend duration?"
- Each suggestion has one-click "Apply" that sends to agent

### 7d. Timeline Ghost Tracks **[v3]**
- Instead of only showing proactive suggestions in the chat panel, render them directly on the `TimelinePanel.tsx` as semi-transparent "ghost" sequence blocks
- `src/agent/proactive/ghost-track-generator.ts` -- Takes a proposed edit (from post-edit analyzer or idle suggestions), runs it through the temporal parser without promoting, and produces ghost `TemporalNode` entries
- Ghost tracks render as faded/dashed blocks on the timeline with inline accept/reject buttons
- Clicking accept sends the proposed code to the agent's `edit_file` tool; clicking reject dismisses
- This lets users approve spatial/temporal suggestions without context-switching to the chat
- Ghost tracks coexist with chat suggestions -- chat shows the explanation, timeline shows the visual

**Key decision:** Heuristics, not Claude calls. Instant and free. Suggestions surface in both chat (with explanation) and timeline (with spatial context).

---

## 8. Web Worker for Compilation **[v2 -- new section]**

**Problem:** Babel compilation and temporal map parsing run on the main thread. Currently <100ms for typical compositions, but during rapid agent loops with multiple edits, cumulative blocking can cause UI jank in the Remotion Player.

**Solution:** Move compilation pipeline to a Web Worker.

**Implementation:**
- `src/engine/compiler.worker.ts` -- Dedicated worker that loads `@babel/standalone`, runs `compileWithVFS()` and `parseTemporalMap()`
- `src/engine/compiler-bridge.ts` -- Main-thread wrapper that posts messages to the worker and returns Promise-based results
- Modify `PreviewPanel.tsx` to use the async bridge instead of synchronous `compileWithVFS()` call
- Modify `store.ts` `setActiveCode` to use async temporal map rebuild

**Why Phase B (not Phase A):**
- Current compilation is fast enough (<100ms) for v1 of the agent loop
- The agent loop has natural pauses (API latency is 1-3 seconds between tool calls)
- Worker adds async complexity to the compilation pipeline
- Ship the agent loop first, then optimize

**Constraints:**
- `@babel/standalone` is ~1.5MB -- loaded once in the worker, not re-downloaded
- Worker must have access to VFS contents via `postMessage` (structured clone)
- Compilation results returned via `postMessage` with component reference (functions can't be cloned -- need `new Function()` on main thread from transpiled source)

---

## 9. Graceful Degradation **[v2 -- new section]**

**Problem:** If the API is down, the user has no API key, or they exhaust their budget, the app should still function as a manual Remotion editor.

**Solution:**
- All agent features are additive -- the core editor (preview, timeline, file tree, manual code editing) works without an API key
- `agentSlice` checks for API key presence before enabling chat input
- When API is unavailable, chat panel shows a clear message: "Set your API key in Settings to enable the AI agent"
- Manual code editing in the file tree remains fully functional
- Compilation, temporal map, preview, export -- all work independently of the agent
- Token budget warning at 80% of user-configured limit; hard stop at 100% with option to increase

---

## 10. Director Input Modalities **[v3 -- new section]**

The current interaction model is entirely text-driven. A real director communicates through gesture and voice, not just typing. These two features transform the input layer to match.

### 10a. Spatial Directives (Draw-to-Animate)

**Problem:** Describing spatial motion paths in text ("move from top-left to bottom-right in an arc") is awkward and imprecise.

**Solution:** Let the user draw motion paths directly on the preview overlay. The agent translates raw coordinates into `interpolate()` and `spring()` code.

**Implementation:**
- Extend `src/inspector/Overlay.tsx` to detect click-and-drag (as opposed to click-to-select). When the user holds and drags, capture the mouse path as an array of `{x, y, frame}` points (frame derived from drag duration mapped to composition fps).
- `src/inspector/path-capture.ts` -- Captures raw SVG path coordinates, simplifies the path (Ramer-Douglas-Peucker algorithm to reduce noise), and normalizes to composition coordinates (accounting for preview scale factor).
- The captured path is included in the agent context as structured data: `{ type: "motion_path", elementId, points: [{x, y, frame}], compositionWidth, compositionHeight }`.
- The agent's system prompt includes instructions for translating path data into keyframed `interpolate()` calls -- mapping x/y coordinates to `translateX`/`translateY` with the captured timing.
- Visual feedback: while drawing, render the path as a dashed SVG line on the overlay. After the agent applies the edit, the line persists briefly as confirmation then fades.

**Key decision:** Path simplification happens client-side (no raw 60fps mouse data sent to Claude). The simplified path (typically 5-15 keypoints) is compact enough to include in the context without significant token cost.

**Files:**
- `src/inspector/Overlay.tsx` -- Add drag detection (distinguish from click-to-select)
- `src/inspector/path-capture.ts` -- Path recording, simplification, normalization
- `src/inspector/PathPreview.tsx` -- SVG overlay showing the drawn path

### 10b. Voice-to-Action (Push-to-Talk)

**Problem:** Typing animation instructions while scrubbing the timeline requires context-switching between hands and keyboard.

**Solution:** Hold-spacebar-to-talk. The user scrubs to the right frame, holds spacebar, speaks ("make the logo fade out right here"), and releases. The transcription is bundled with the exact frame and sent to the agent.

**Implementation:**
- `src/editor/chat/VoiceInput.tsx` -- Manages the Web Speech API (`SpeechRecognition`) lifecycle. Activated by spacebar-hold (when chat input is not focused, to avoid conflict with typing).
- On spacebar down: start recording, show pulsing mic indicator in chat header, capture current frame from `playerSlice.currentFrame`
- On spacebar up: stop recording, receive transcript, inject into chat input as `{ text: transcript, frame: capturedFrame }` context
- The agent receives the voice instruction with frame context, identical to a typed message with a context pill
- Fallback: if `SpeechRecognition` is not available (Firefox on some platforms), show a tooltip suggesting Chrome/Edge

**Key decision:** Use the browser's native Web Speech API (zero dependencies, zero cost). It's good enough for short directive phrases. Production upgrade path: swap in Deepgram or Whisper API for better accuracy, but the interface stays the same.

**Browser support:** Chrome, Edge, Safari 14.1+ (covers ~85% of users). Progressive enhancement -- voice is additive, typing always works.

**Files:**
- `src/editor/chat/VoiceInput.tsx` -- SpeechRecognition wrapper, spacebar-hold detection
- `src/editor/chat/VoiceIndicator.tsx` -- Pulsing mic icon during recording

---

## 11. External AI Integration

### 11a. Vision for Reference Analysis
- Claude's native vision already supports image input
- Tool: `analyze_reference` -- User uploads image/video frame, agent extracts mood, palette, pacing
- Feeds into generation: "Create a composition matching this style"

### 11b. Video Generation APIs (Future)
- Tool: `generate_asset` -- Calls Sora/Runway/Pika APIs for asset generation
- Server route: `POST /api/generate-asset` proxies to external APIs
- Generated assets saved to VFS, referenced via `staticFile()` in Remotion
- Start with tool definition returning "not configured" -- full implementation in later phase

### 11c. Asset Sourcing **[v3]**
- Tool: `fetch_external_asset` -- Agent calls free APIs (Unsplash for images, Pexels for images/video, Freesound for audio) when user requests assets not in the project
- Server route: `POST /api/fetch-asset` in render server -- proxies to external APIs, downloads the file, returns it to the browser
- The tool saves the downloaded asset to the VFS and returns the file path
- Agent then uses `edit_file` to write `<Img src={staticFile('coffee.jpg')} />` or `<Audio src={staticFile('lofi.mp3')} />` into the composition
- Attribution handling: Unsplash/Pexels require attribution. The tool stores attribution metadata in a `_credits.json` file in the VFS. Agent adds a credits comment in the source code.
- API keys for asset services stored in `settingsSlice` alongside the Anthropic key

### 11d. Model Flexibility
- Extend `settingsSlice` with `modelId: string` and `apiEndpoint: string`
- Model registry in `src/agent/models.ts` mapping IDs to capabilities (supports_vision, supports_tools, max_tokens)
- Enables: Anthropic models, OpenAI-compatible endpoints (for self-hosted Nemotron/etc.)

### 11e. In-Browser Semantic Search (Future) **[v2]**
- Transformers.js with WASM backend (not WebGPU -- WASM is faster for small embedding models at 8-12ms)
- `all-MiniLM-L6-v2` quantized (~22MB download, cached after first load)
- Embeds edit journal entries for semantic retrieval: "make it look like that dark mode promo we did"
- Deferred to Phase F -- keyword + recency search covers 90% of cases first

---

## 12. UI/UX Transformation Summary

The shift from "tool UI" to "collaborator UI":

| Before | After |
|--------|-------|
| Modal command palette (Cmd+K) | Persistent chat panel, Cmd+K focuses input |
| Separate generate panel | Same chat panel, same conversation |
| Properties panel (read-only) | Context tab in chat panel |
| Edit mode toggle | Always-on selection |
| Monolithic JSON response | Tool call cards with diffs, screenshots |
| No agent visibility | Activity feed showing agent's work |
| Static error display | Agent self-corrects, explains what went wrong |
| No suggestions | Inline suggestion cards with visual before/after previews |
| No memory | "Welcome back -- last time you were working on..." |
| **[v2]** No cost visibility | Token usage tracker in chat header |
| **[v2]** No abort control | Abort button + Escape to stop agent mid-execution |
| **[v2]** Breaks without API key | Full manual editor works; agent features are additive |
| **[v3]** Text-only spatial input | Draw motion paths directly on the preview overlay |
| **[v3]** Type-only interaction | Hold spacebar to speak while scrubbing the timeline |
| **[v3]** Suggestions only in chat | Ghost tracks render proposed edits directly on the timeline |

---

## 13. Cutting-Edge Innovations Evaluated

| Innovation | Use Case | Verdict |
|------------|----------|---------|
| **Anthropic Prompt Caching** | 90% cost reduction on cached agent loop context | **Adopt in Phase A.** Non-negotiable for agent loops. |
| **Anthropic `think` tool** | Internal reasoning between tool calls | **Adopt in Phase A.** Recommended by Anthropic for sequential tool chains. |
| **Remotion `renderStill()`** | Pixel-perfect frame capture for visual grounding | **Adopt in Phase B.** Replaces html-to-image. More reliable, uses Remotion's own pipeline. |
| **NVIDIA NemoClaw** | Policy-based agent sandboxing, audit trails | Not needed for v1. Revisit for team/collab features. |
| **Nemotron 3 Super** | 1M token context, open weights, self-hosted | Future model option via flexible registry. Self-hosting adds operational burden. |
| **Google TurboQuant** | 3-bit KV cache compression for local inference | Relevant only if we self-host models. Phase F+. |
| **Mem0** | External memory service | Overkill -- structured IDB profile captures 80% of value with zero deps. |
| **LangGraph/AutoGen** | Multi-agent orchestration | Adds latency and complexity. Single agent with tools achieves same behavior. |
| **html-to-image** | DOM-to-image capture | **Rejected.** Fragile with Remotion's rendering. `renderStill()` is more reliable. |
| **Transformers.js (WASM)** | In-browser semantic search over edit history | **Defer to Phase F.** Keyword + recency search is sufficient first. |
| **Sora/Runway/Pika APIs** | AI asset generation | Adopt as future tool stub. Full implementation when APIs stabilize. |
| **Claude Vision** | Reference image analysis, visual verification | **Adopt.** Already supported, zero new deps. |
| **MCP protocol** | Standardized tool interface | Adopt schema format now. Full MCP server wrapper in Phase F. |
| **[v3] Spatial Directives** | Draw motion paths on preview overlay | **Adopt in Phase E.** Natural director interaction. Overlay.tsx already handles click detection. |
| **[v3] Web Speech API** | Voice-to-action with frame context | **Adopt in Phase E.** Zero-dependency, ~85% browser coverage. Progressive enhancement. |
| **[v3] Timeline Ghost Tracks** | Render proactive suggestions on timeline | **Adopt in Phase D.** Strong spatial UX. Timeline already renders sequence blocks. |
| **[v3] Asset Sourcing APIs** | Unsplash/Pexels/Freesound for external assets | **Adopt in Phase E.** Fills real workflow gap. Needs attribution handling. |

---

## 14. Implementation Phases

### Phase A: Agent Core + Prompt Caching + Chat UI (3 weeks)
The foundation everything else builds on.

1. `src/agent/types.ts` -- Agent state machine types (including PAUSED state)
2. `src/agent/runner.ts` -- Tool-calling agent loop with circuit breakers (max 25 iterations, token tracking)
3. `src/agent/session.ts` -- Conversation lifecycle
4. `src/agent/cache-manager.ts` -- Prompt caching breakpoint management
5. `src/agent/tools/types.ts` -- Tool interface
6. Core tools: `think`, `edit_file`, `read_file`, `list_files`, `create_file`, `check_compilation`, `seek_to_frame`, `get_temporal_map`, `get_element_info`
7. `agentSlice` in `src/store.ts` (with tokenUsage, iterationCount)
8. `src/agent/context.ts` -- Unified context builder
9. Refactor `src/ai/system-prompt.ts` with tool descriptions + plan-then-execute instructions
10. Extend `src/ai/client.ts` for tool_use content blocks, streaming tool events, cache_control annotations
11. `src/editor/chat/AgentChat.tsx` -- Persistent chat panel (alongside existing UI, feature-flagged)
12. `src/editor/chat/MessageList.tsx`, `ToolCallCard.tsx`, `ContextPill.tsx`, `ThinkingIndicator.tsx`
13. Wire Cmd+K to focus chat panel (when feature flag enabled)
14. Graceful degradation: chat disabled without API key, manual editor always works

### Phase B: Visual Grounding + Web Worker (2 weeks)
Depends on Phase A.

1. `POST /api/render/still` endpoint in render server using `renderStill()`
2. `capture_frame` and `capture_sequence` tools (calling render server)
3. Image content block support in agent runner
4. System prompt additions for visual verification guidance
5. `src/engine/compiler.worker.ts` -- Web Worker for Babel compilation
6. `src/engine/compiler-bridge.ts` -- Async wrapper for main thread
7. Migrate `PreviewPanel.tsx` and `store.ts` to async compilation

### Phase C: Memory Layer (2 weeks)
Depends on Phase A.

1. Extend IDB schema: `conversations`, `userProfile`, `editJournal` stores
2. `src/agent/memory/style-extractor.ts`
3. `src/agent/memory/profile-store.ts`
4. `src/agent/memory/edit-journal.ts`
5. `get_user_profile` tool
6. Session persistence and restoration
7. Inject user profile into system prompt (as cacheable content)

### Phase D: Proactive Intelligence + Ghost Tracks (1-2 weeks)
Depends on Phases A + B + C.

1. `src/agent/proactive/post-edit-analyzer.ts`
2. `src/agent/proactive/style-checker.ts`
3. `src/agent/proactive/idle-suggestions.ts`
4. Suggestion rendering in AgentChat with before/after frame captures
5. **[v3]** `src/agent/proactive/ghost-track-generator.ts` -- Generate ghost TemporalNodes from proposed edits
6. **[v3]** Extend `TimelinePanel.tsx` with ghost track rendering (semi-transparent blocks, inline accept/reject)

### Phase E: UI Migration + Director Inputs + External Integration (3 weeks)
Depends on Phases A + B.

1. Remove feature flag -- AgentChat becomes default
2. Remove old CommandPalette and GenerateChat
3. Restructure EditorLayout to final `[FileTree] [Preview+Timeline] [ChatPanel]` layout
4. Reference image analysis via Claude vision
5. `render_preview` tool (short GIF renders)
6. `generate_asset` tool stub + server route
7. Flexible model registry in `src/agent/models.ts`
8. **[v3]** Spatial Directives: `src/inspector/path-capture.ts`, `PathPreview.tsx`, extend `Overlay.tsx` with drag-to-draw
9. **[v3]** Voice-to-Action: `src/editor/chat/VoiceInput.tsx`, `VoiceIndicator.tsx`, spacebar-hold-to-talk with frame context
10. **[v3]** Asset Sourcing: `fetch_external_asset` tool, `POST /api/fetch-asset` server route, attribution handling

### Phase F: Advanced Features (ongoing)
Depends on all previous phases.

1. MCP server wrapper for external tool access
2. In-browser semantic search via Transformers.js WASM
3. Nemotron/OpenAI-compatible model support
4. Collaborative editing features
5. Advanced ghost previews with animated comparison

**Minimum Viable Agentic Experience: Phase A** (3 weeks)
**Visually Grounded Agent: A + B** (5 weeks)
**Full Agentic Experience: A + B + C + D + E** (11-12 weeks)

---

## 15. Verification Plan

### Phase A verification:
- User types "create a bouncing ball animation" in chat -> agent calls `think` (plans steps), `create_file`, `edit_file`, `check_compilation` in sequence -> shows tool cards -> preview updates
- User clicks element, types "make it red" -> context pill shows element, agent calls `edit_file` -> compilation succeeds -> preview updates
- If compilation fails, agent sees error in tool result and retries without user intervention
- Hit 25-tool-call limit -> agent pauses and shows progress, asks user to continue
- Token usage counter in chat header updates after each turn
- Close browser, reopen -> old CommandPalette still works (feature flag off); toggle feature flag -> AgentChat appears
- No API key set -> chat panel shows setup prompt, manual editor works fully

### Phase B verification:
- After editing, agent calls `capture_frame` at key frames -> pixel-perfect screenshots appear in chat as image cards
- Agent uses visual output to catch issues ("the text is positioned off-screen, let me adjust")
- During rapid agent edits, Remotion Player plays smoothly (compilation offloaded to worker)

### Phase C verification:
- Close and reopen browser -> agent says "Welcome back -- you were working on [composition name]"
- After 10+ edits, agent starts using user's preferred easing/colors without being told

### Phase D verification:
- Agent applies an edit -> proactive suggestion appears with before/after frame previews
- User clicks "Apply" -> agent executes the suggestion
- **[v3]** Idle suggestion renders as a ghost track on the timeline (semi-transparent block) -> clicking the checkmark on the timeline applies the edit without opening chat

### Phase E verification:
- User uploads reference image -> agent analyzes style and generates matching composition
- User says "render a preview" -> agent calls render server -> GIF appears in chat
- Old CommandPalette and GenerateChat removed, all interactions through AgentChat
- **[v3]** User selects an element, clicks and drags a curved path on the preview -> path appears as dashed SVG -> agent translates to interpolate() keyframes -> element follows the drawn path
- **[v3]** User scrubs to frame 45, holds spacebar, says "fade this out now" -> transcription appears in chat with frame context -> agent applies fade-out starting at frame 45
- **[v3]** User says "add a coffee cup image" -> agent calls `fetch_external_asset` (Unsplash) -> image saved to VFS -> agent writes `<Img>` component into composition -> attribution logged

---

## 16. Critical Files Reference

| File | Action | Phase |
|------|--------|-------|
| `src/store.ts` | Add agentSlice | A |
| `src/ai/client.ts` | Extend for tool_use + cache_control + streaming | A |
| `src/ai/system-prompt.ts` | Rewrite with tools + plan-then-execute | A |
| `src/ai/context-assembler.ts` | Refactor into unified builder | A |
| `src/editor/layout/EditorLayout.tsx` | Add AgentChat panel (feature-flagged) | A |
| `server/render-server.ts` | Add POST /api/render/still | B |
| `src/engine/compiler.ts` | Extract to Web Worker | B |
| `src/persistence/idb.ts` | Add conversations, userProfile, editJournal stores | C |
| `src/editor/prompt/CommandPalette.tsx` | Remove | E |
| `src/editor/prompt/ContextDisplay.tsx` | Remove (logic in AgentChat) | E |
| `src/inspector/Overlay.tsx` | Add drag-to-draw path capture | E |
| `src/editor/layout/TimelinePanel.tsx` | Add ghost track rendering | D |
| `server/render-server.ts` | Add POST /api/fetch-asset | E |
