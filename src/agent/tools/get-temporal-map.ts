import { useStore } from "@/store";

import type { AgentTool, ToolResult } from "./types";

export const getTemporalMapTool: AgentTool = {
  name: "get_temporal_map",
  description:
    "Returns the temporal map for the active composition: all JSX elements, their frame visibility ranges, and detected animations. Use this to understand the timeline structure before making edits.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (_input: unknown): Promise<ToolResult> => {
    const { temporalMap } = useStore.getState();

    if (!temporalMap) {
      return {
        type: "text",
        text: "No temporal map available. Load a composition first.",
      };
    }

    const nodes = [...temporalMap.nodes.values()].map((node) => ({
      id: node.id,
      componentName: node.componentName,
      sourceRange: node.sourceRange,
      activeFrameRange: node.activeFrameRange,
      sequencePath: node.sequencePath,
      animations: node.animations.map((a) => ({
        property: a.property,
        type: a.type,
        frameRange: a.frameRange,
        valueRange: a.valueRange,
        sourceExpression: a.sourceExpression,
      })),
    }));

    const summary = {
      compositionDuration: temporalMap.compositionDuration,
      fps: temporalMap.fps,
      nodeCount: nodes.length,
      nodes,
    };

    return { type: "text", text: JSON.stringify(summary, null, 2) };
  },
};
