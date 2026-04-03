import { z } from "zod";
import { useStore } from "@/store";
import { compileWithVFS } from "@/engine/compiler";

import type { AgentTool, ToolResult } from "./types";

const InputSchema = z.object({
  path: z.string(),
  code: z.string(),
});

export const editFileTool: AgentTool = {
  name: "edit_file",
  description:
    "Write new code to a file in the virtual file system. The code is compiled immediately. If compilation succeeds the preview updates. If compilation fails the error is returned and the existing code is left untouched. Always write complete file contents — do not write partial diffs.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file path to write, e.g. '/composition.tsx'.",
      },
      code: {
        type: "string",
        description: "The full new source code for the file.",
      },
    },
    required: ["path", "code"],
  },
  execute: async (input: unknown): Promise<ToolResult> => {
    const { path, code } = InputSchema.parse(input);
    const store = useStore.getState();

    // Build the VFS snapshot with the new code substituted in
    const fileMap = new Map<string, string>();
    store.files.forEach((file, filePath) => {
      fileMap.set(filePath, filePath === path ? code : file.activeCode);
    });

    // If this is a new file not yet in VFS, add it
    if (!fileMap.has(path)) {
      fileMap.set(path, code);
    }

    const entryPath = store.activeFilePath ?? path;

    // Compile synchronously — do not touch the store until we know the result
    const result = compileWithVFS(entryPath, fileMap);

    if (!result.ok) {
      return {
        type: "text",
        text: `Compilation failed: ${result.error}`,
      };
    }

    // Compilation succeeded — persist to store so the Player re-renders
    if (!store.files.has(path)) {
      store.createFile(path, code);
    } else {
      // setActiveCode updates activeCode and rebuilds the temporal map
      store.setActiveCode(path, code);
    }

    store.pushSnapshot(`Agent edited ${path}`);

    return {
      type: "text",
      text: `Successfully compiled and applied ${path}.`,
    };
  },
};
