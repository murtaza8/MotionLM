import { z } from "zod";
import { useStore } from "@/store";

import type { AgentTool, ToolResult } from "./types";

const InputSchema = z.object({
  path: z.string(),
});

export const readFileTool: AgentTool = {
  name: "read_file",
  description: "Read the current contents of a file in the virtual file system.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file path to read, e.g. '/composition.tsx'.",
      },
    },
    required: ["path"],
  },
  execute: async (input: unknown): Promise<ToolResult> => {
    const { path } = InputSchema.parse(input);
    const file = useStore.getState().files.get(path);
    if (!file) {
      return { type: "text", text: `File not found: ${path}` };
    }
    return { type: "text", text: file.activeCode };
  },
};
