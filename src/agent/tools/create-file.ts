import { z } from "zod";
import { useStore } from "@/store";
import { compileWithVFS } from "@/engine/compiler";

import type { AgentTool, ToolResult } from "./types";

const InputSchema = z.object({
  path: z.string(),
  code: z.string(),
});

export const createFileTool: AgentTool = {
  name: "create_file",
  description:
    "Create a new file in the virtual file system. The code is compiled before the file is created. Fails if the file already exists or if compilation fails. Use edit_file to modify existing files.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file path to create, e.g. '/components/Title.tsx'.",
      },
      code: {
        type: "string",
        description: "The initial content for the new file.",
      },
    },
    required: ["path", "code"],
  },
  execute: async (input: unknown): Promise<ToolResult> => {
    const { path, code } = InputSchema.parse(input);
    const store = useStore.getState();

    if (store.files.has(path)) {
      return {
        type: "text",
        text: `File already exists: ${path}. Use edit_file to modify it.`,
      };
    }

    // Build hypothetical VFS with the new file included
    const fileMap = new Map<string, string>();
    store.files.forEach((file, filePath) => {
      fileMap.set(filePath, file.activeCode);
    });
    fileMap.set(path, code);

    // Compile to validate before committing to VFS
    const entryPath = store.activeFilePath ?? path;
    const result = compileWithVFS(entryPath, fileMap);

    if (!result.ok) {
      return {
        type: "text",
        text: `Compilation failed: ${result.error}`,
      };
    }

    store.createFile(path, code);
    store.pushSnapshot(`Agent created ${path}`);
    return { type: "text", text: `Created ${path}.` };
  },
};
