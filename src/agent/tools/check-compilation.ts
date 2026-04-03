import { z } from "zod";
import { useStore } from "@/store";
import { compileWithVFS } from "@/engine/compiler";

import type { AgentTool, ToolResult } from "./types";

const InputSchema = z.object({
  path: z.string(),
  code: z.string(),
});

export const checkCompilationTool: AgentTool = {
  name: "check_compilation",
  description:
    "Dry-run compile a file without writing it to the VFS or updating the preview. Use this to validate code before committing it with edit_file.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file path the code would be written to.",
      },
      code: {
        type: "string",
        description: "The source code to validate.",
      },
    },
    required: ["path", "code"],
  },
  execute: async (input: unknown): Promise<ToolResult> => {
    const { path, code } = InputSchema.parse(input);
    const store = useStore.getState();

    // Build a hypothetical VFS with this code substituted in
    const fileMap = new Map<string, string>();
    store.files.forEach((file, filePath) => {
      fileMap.set(filePath, filePath === path ? code : file.activeCode);
    });
    if (!fileMap.has(path)) {
      fileMap.set(path, code);
    }

    const entryPath = store.activeFilePath ?? path;
    const result = compileWithVFS(entryPath, fileMap);

    if (result.ok) {
      return { type: "text", text: "Compilation successful." };
    }
    return { type: "text", text: `Compilation error: ${result.error}` };
  },
};
