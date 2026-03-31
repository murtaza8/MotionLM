import { z } from "zod";
import { useStore } from "@/store";

import type { AgentTool, ToolResult } from "./types";

const InputSchema = z.object({
  thought: z.string(),
});

export const thinkTool: AgentTool = {
  name: "think",
  description:
    "Internal reasoning scratchpad. Use this to plan complex edits, reason through trade-offs, or think step-by-step before acting. Output is stored and viewable by the user but not sent back to Claude as a new message. Zero-latency — returns immediately.",
  input_schema: {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "Your reasoning, plan, or analysis.",
      },
    },
    required: ["thought"],
  },
  execute: async (input: unknown): Promise<ToolResult> => {
    const { thought } = InputSchema.parse(input);
    useStore.getState().appendThinkLog(thought);
    return { type: "text", text: "ok" };
  },
};
