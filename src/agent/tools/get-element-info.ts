import { z } from "zod";
import { useStore } from "@/store";

import type { AgentTool, ToolResult } from "./types";

const InputSchema = z.object({
  elementId: z.string(),
  frame: z.number().int().nonnegative().optional(),
});

export const getElementInfoTool: AgentTool = {
  name: "get_element_info",
  description:
    "Get detailed information about a specific JSX element by its temporal map id (format: 'ComponentName:lineNumber'). Optionally provide a frame to check visibility and animation state at that point in time.",
  input_schema: {
    type: "object",
    properties: {
      elementId: {
        type: "string",
        description:
          "The element id from the temporal map, e.g. 'AbsoluteFill:5'.",
      },
      frame: {
        type: "number",
        description:
          "Optional frame number to evaluate animation state at that frame.",
      },
    },
    required: ["elementId"],
  },
  execute: async (input: unknown): Promise<ToolResult> => {
    const { elementId, frame } = InputSchema.parse(input);
    const { temporalMap } = useStore.getState();

    if (!temporalMap) {
      return {
        type: "text",
        text: "No temporal map available. Load a composition first.",
      };
    }

    const node = temporalMap.nodes.get(elementId);
    if (!node) {
      return {
        type: "text",
        text: `Element '${elementId}' not found. Use get_temporal_map to list available elements.`,
      };
    }

    const isVisibleAtFrame =
      frame === undefined
        ? null
        : node.activeFrameRange === null
          ? true
          : frame >= node.activeFrameRange[0] && frame < node.activeFrameRange[1];

    const activeAnimationsAtFrame =
      frame === undefined
        ? null
        : node.animations.filter(
            (a) => frame >= a.frameRange[0] && frame <= a.frameRange[1]
          );

    const info = {
      id: node.id,
      componentName: node.componentName,
      sourceRange: node.sourceRange,
      activeFrameRange: node.activeFrameRange,
      sequencePath: node.sequencePath,
      animations: node.animations,
      ...(frame !== undefined && {
        atFrame: frame,
        isVisible: isVisibleAtFrame,
        activeAnimations: activeAnimationsAtFrame,
      }),
    };

    return { type: "text", text: JSON.stringify(info, null, 2) };
  },
};
