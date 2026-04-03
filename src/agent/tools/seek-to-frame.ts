import { z } from "zod";
import { useStore } from "@/store";

import type { AgentTool, ToolResult } from "./types";

const InputSchema = z.object({
  frame: z.number().int().nonnegative(),
});

export const seekToFrameTool: AgentTool = {
  name: "seek_to_frame",
  description:
    "Move the player playhead to a specific frame. Useful for inspecting the composition at a particular point in time before requesting a frame capture.",
  input_schema: {
    type: "object",
    properties: {
      frame: {
        type: "number",
        description: "The frame number to seek to (0-indexed).",
      },
    },
    required: ["frame"],
  },
  execute: async (input: unknown): Promise<ToolResult> => {
    const { frame } = InputSchema.parse(input);
    const store = useStore.getState();
    const { durationInFrames } = store;

    if (frame >= durationInFrames) {
      return {
        type: "text",
        text: `Frame ${frame} is out of range. Composition has ${durationInFrames} frames (0–${durationInFrames - 1}).`,
      };
    }

    store.setCurrentFrame(frame);
    store.setPlaying(false);
    return { type: "text", text: `Seeked to frame ${frame}.` };
  },
};
