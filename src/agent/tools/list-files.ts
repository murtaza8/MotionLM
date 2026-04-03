import { useStore } from "@/store";

import type { AgentTool, ToolResult } from "./types";

export const listFilesTool: AgentTool = {
  name: "list_files",
  description: "List all files currently in the virtual file system.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (_input: unknown): Promise<ToolResult> => {
    const files = useStore.getState().files;
    if (files.size === 0) {
      return { type: "text", text: "No files in the virtual file system." };
    }
    const paths = [...files.keys()].join("\n");
    return { type: "text", text: paths };
  },
};
