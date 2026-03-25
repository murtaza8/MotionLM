import type { TemporalNode, AnimationDescriptor } from "@/engine/temporal/types";
import type { EditContext } from "@/ai/system-prompt";
import type { Message } from "@/ai/client";

// ---------------------------------------------------------------------------
// StoreSnapshot — the subset of store state needed here
// ---------------------------------------------------------------------------

export interface StoreSnapshot {
  files: Map<string, { activeCode: string }>;
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
// buildFrameNarrative
// ---------------------------------------------------------------------------

export function buildFrameNarrative(node: TemporalNode, frame: number): string {
  const parts: string[] = [];

  // Frame position
  const rangeStr =
    node.activeFrameRange !== null
      ? `frames ${node.activeFrameRange[0]}-${node.activeFrameRange[1]}`
      : "always visible";
  parts.push(
    `Frame ${frame}. Element '${node.componentName}' is active (${rangeStr}).`
  );

  // Sequence ancestry
  if (node.sequencePath.length > 0) {
    parts.push(`Sequence path: ${node.sequencePath.join(" > ")}.`);
  }

  // Animation states
  if (node.animations.length === 0) {
    parts.push("No animations detected on this element.");
  } else {
    for (const anim of node.animations) {
      parts.push(describeAnimation(anim, frame));
    }
  }

  return parts.join(" ");
}

function describeAnimation(anim: AnimationDescriptor, frame: number): string {
  const [start, end] = anim.frameRange;
  const duration = end - start;

  if (anim.type === "dynamic") {
    return `${anim.property}: dynamic expression (cannot evaluate statically).`;
  }

  if (frame < start) {
    return `${anim.property} ${anim.type}: not yet started (begins at frame ${start}).`;
  }

  if (frame >= end) {
    if (anim.type === "spring") {
      return `${anim.property} spring: settled at ${anim.valueRange[1]}.`;
    }
    const [, outEnd] = anim.valueRange;
    return `${anim.property} interpolation: complete, value is ${outEnd}.`;
  }

  // In progress
  const progress = duration > 0 ? (frame - start) / duration : 1;
  const progressPct = Math.round(progress * 100);

  if (anim.type === "spring") {
    const approxValue =
      anim.valueRange[0] + (anim.valueRange[1] - anim.valueRange[0]) * progress;
    return (
      `${anim.property} spring: ~${progressPct}% complete, ` +
      `approximate value ~${approxValue.toFixed(2)}.`
    );
  }

  // interpolate
  const [outStart, outEnd] = anim.valueRange;
  const approxValue = outStart + (outEnd - outStart) * progress;
  const clampNote =
    anim.easing?.extrapolateRight === "clamp" ? " (clamped)" : "";
  return (
    `${anim.property} interpolation: ${progressPct}% complete, ` +
    `interpolating from ${outStart} to ${outEnd} over frames ${start}-${end}, ` +
    `current value ~${approxValue.toFixed(2)}${clampNote}.`
  );
}

// ---------------------------------------------------------------------------
// assembleEditContext
// ---------------------------------------------------------------------------

export function assembleEditContext(store: StoreSnapshot): EditContext {
  const filePath = store.activeFilePath ?? "";
  const file = filePath ? store.files.get(filePath) : undefined;
  const sourceCode = file?.activeCode ?? "";

  const frame = store.selectedFrame ?? 0;

  if (store.selectedElementId === null || store.temporalMap === null) {
    return {
      sourceCode,
      filePath,
      currentFrame: frame,
      selectedElement: null,
    };
  }

  const node = store.temporalMap.nodes.get(store.selectedElementId);
  if (node === undefined) {
    return {
      sourceCode,
      filePath,
      currentFrame: frame,
      selectedElement: null,
    };
  }

  const frameNarrative = buildFrameNarrative(node, frame);

  return {
    sourceCode,
    filePath,
    currentFrame: frame,
    selectedElement: {
      id: node.id,
      componentName: node.componentName,
      lineStart: node.sourceRange[0],
      lineEnd: node.sourceRange[1],
      frameNarrative,
    },
  };
}

// ---------------------------------------------------------------------------
// assembleMessages
// ---------------------------------------------------------------------------

export function assembleMessages(
  context: EditContext,
  instruction: string,
  systemPrompt: string
): Message[] {
  // The system prompt is passed separately to the Claude API; we include it
  // as the first user turn here so callers can pass it through client.ts
  // without needing a separate system field (Anthropic Messages API supports
  // a top-level system param, but we keep this transport-agnostic).
  //
  // Callers that want to use the native system param should extract it and
  // pass messages without the injected system turn.
  return [
    {
      role: "user",
      content: [systemPrompt, buildEditPromptContent(context, instruction)].join(
        "\n\n"
      ),
    },
  ];
}

function buildEditPromptContent(context: EditContext, instruction: string): string {
  const parts: string[] = [];

  parts.push(`<source-file path="${context.filePath}">`);
  parts.push(context.sourceCode);
  parts.push("</source-file>");

  if (context.selectedElement !== null) {
    const el = context.selectedElement;
    parts.push(
      `<selected-element id="${el.id}" component="${el.componentName}" ` +
        `lines="${el.lineStart}-${el.lineEnd}" frame="${context.currentFrame}">`
    );
    parts.push(el.frameNarrative);
    parts.push("</selected-element>");
  } else {
    parts.push(
      `<context frame="${context.currentFrame}">No element selected. Apply the edit to the composition as a whole.</context>`
    );
  }

  parts.push(`<instruction>${instruction}</instruction>`);

  return parts.join("\n");
}
