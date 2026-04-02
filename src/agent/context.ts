import { buildFrameNarrative } from "@/ai/context-assembler";

import type { TemporalNode } from "@/engine/temporal/types";
import type { VFSFile } from "@/store";
import type { AgentMessage, TextContentBlock } from "./types";

// ---------------------------------------------------------------------------
// StoreSnapshot — subset of store state needed to build context
// ---------------------------------------------------------------------------

export interface AgentStoreSnapshot {
  files: Map<string, Pick<VFSFile, "activeCode" | "compilationStatus" | "compilationError">>;
  activeFilePath: string | null;
  selectedElementId: string | null;
  selectedFrame: number | null;
  temporalMap: {
    nodes: Map<string, TemporalNode>;
    compositionDuration: number;
    fps: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns an XML attribute string describing a file's compilation state.
 * Empty files get status="empty". Error files get status="error" with the
 * error message. Successful files get status="ok". Idle/compiling omitted.
 */
function fileStatusAttr(
  file: Pick<VFSFile, "activeCode" | "compilationStatus" | "compilationError">
): string {
  if (!file.activeCode.trim()) return ' status="empty"';
  if (file.compilationStatus === "error") {
    const msg = file.compilationError ?? "unknown error";
    // Escape double-quotes so the attribute is valid XML
    const escaped = msg.replace(/"/g, "&quot;");
    return ` status="error" error="${escaped}"`;
  }
  if (file.compilationStatus === "success") return ' status="ok"';
  return "";
}

// ---------------------------------------------------------------------------
// buildAgentUserMessage
// ---------------------------------------------------------------------------

/**
 * Builds the user-role AgentMessage for one agent turn.
 *
 * Content layout:
 * 1. Active file source (or all files if multiple)
 * 2. Temporal map summary for the active file
 * 3. Selected element + frame narrative (if any)
 * 4. User instruction (last block — most recent, least likely to be cached)
 */
export function buildAgentUserMessage(
  store: AgentStoreSnapshot,
  userText: string
): AgentMessage {
  const blocks: TextContentBlock[] = [];

  // --- VFS files ---
  if (store.files.size > 0) {
    const activeFilePath = store.activeFilePath;

    if (store.files.size === 1) {
      const [path, file] = [...store.files.entries()][0];
      const statusAttr = fileStatusAttr(file);
      blocks.push({
        type: "text",
        text: `<source-file path="${path}"${statusAttr}>\n${file.activeCode}\n</source-file>`,
      });
    } else {
      // Multiple files: include all, highlight the active one
      const fileParts: string[] = [];
      store.files.forEach((file, path) => {
        const isActive = path === activeFilePath ? " active=\"true\"" : "";
        const statusAttr = fileStatusAttr(file);
        fileParts.push(
          `<file path="${path}"${isActive}${statusAttr}>\n${file.activeCode}\n</file>`
        );
      });
      blocks.push({
        type: "text",
        text: `<virtual-file-system>\n${fileParts.join("\n\n")}\n</virtual-file-system>`,
      });
    }
  }

  // --- Temporal map ---
  if (store.temporalMap) {
    const { temporalMap } = store;
    const nodeSummaries = [...temporalMap.nodes.values()].map((n) => {
      const range = n.activeFrameRange
        ? `frames ${n.activeFrameRange[0]}-${n.activeFrameRange[1]}`
        : "always visible";
      const animCount = n.animations.length;
      return `  ${n.id} (${range})${animCount > 0 ? ` — ${animCount} animation(s)` : ""}`;
    });

    blocks.push({
      type: "text",
      text: [
        `<temporal-map duration="${temporalMap.compositionDuration}frames" fps="${temporalMap.fps}">`,
        nodeSummaries.join("\n"),
        `</temporal-map>`,
      ].join("\n"),
    });
  }

  // --- Selected element ---
  const { selectedElementId, selectedFrame } = store;
  if (selectedElementId !== null) {
    const frame = selectedFrame ?? 0;
    const node = store.temporalMap?.nodes.get(selectedElementId) ?? null;

    if (node !== null) {
      const narrative = buildFrameNarrative(node, frame);
      blocks.push({
        type: "text",
        text: [
          `<selected-element id="${node.id}" component="${node.componentName}" `,
          `lines="${node.sourceRange[0]}-${node.sourceRange[1]}" frame="${frame}">`,
          narrative,
          `</selected-element>`,
        ].join(""),
      });
    } else {
      // Element id present but not in temporal map — extract what we can
      const colonIdx = selectedElementId.lastIndexOf(":");
      const componentName =
        colonIdx !== -1
          ? selectedElementId.slice(0, colonIdx)
          : selectedElementId;
      const lineNumber =
        colonIdx !== -1
          ? parseInt(selectedElementId.slice(colonIdx + 1), 10)
          : 0;
      const line = Number.isFinite(lineNumber) ? lineNumber : 0;

      blocks.push({
        type: "text",
        text: `<selected-element id="${selectedElementId}" component="${componentName}" line="${line}" frame="${frame}">Element selected at line ${line}, frame ${frame}. No temporal data available.</selected-element>`,
      });
    }
  }

  // --- User instruction (last block) ---
  blocks.push({
    type: "text",
    text: `<instruction>${userText}</instruction>`,
  });

  return { role: "user", content: blocks };
}

// ---------------------------------------------------------------------------
// buildFollowUpUserMessage
// ---------------------------------------------------------------------------

/**
 * Builds a lightweight follow-up user message for subsequent turns in the
 * same session. Omits the full file dump (already in conversation history)
 * and only includes changed context + the new instruction.
 */
export function buildFollowUpUserMessage(
  store: AgentStoreSnapshot,
  userText: string
): AgentMessage {
  const blocks: TextContentBlock[] = [];

  // Only include selected element if it changed
  const { selectedElementId, selectedFrame } = store;
  if (selectedElementId !== null) {
    const frame = selectedFrame ?? 0;
    const node = store.temporalMap?.nodes.get(selectedElementId) ?? null;
    if (node !== null) {
      const narrative = buildFrameNarrative(node, frame);
      blocks.push({
        type: "text",
        text: `<selected-element id="${node.id}" component="${node.componentName}" frame="${frame}">${narrative}</selected-element>`,
      });
    }
  }

  blocks.push({
    type: "text",
    text: `<instruction>${userText}</instruction>`,
  });

  return { role: "user", content: blocks };
}
