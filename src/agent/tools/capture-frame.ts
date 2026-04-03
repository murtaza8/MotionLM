import { z } from "zod";
import { useStore } from "@/store";

import type { AgentTool, ToolResult } from "./types";

const InputSchema = z.object({
  frame: z.number().int().min(0).optional(),
  compositionId: z.string().optional(),
});

export const captureFrameTool: AgentTool = {
  name: "capture_frame",
  description:
    "Render a still image of the composition at a specific frame number. Returns a PNG image. Only call this when the user explicitly asks to see or preview the result. Do NOT call after edits — the user already sees the live preview. Defaults to the current playhead frame if no frame is specified.",
  input_schema: {
    type: "object",
    properties: {
      frame: {
        type: "number",
        description:
          "Frame number to capture (0-indexed). Defaults to the current playhead frame.",
      },
      compositionId: {
        type: "string",
        description:
          "Remotion composition ID to render. Defaults to 'Main'.",
      },
    },
  },
  execute: async (input: unknown): Promise<ToolResult> => {
    const { frame: requestedFrame, compositionId } = InputSchema.parse(input);

    const store = useStore.getState();
    const frame = requestedFrame ?? store.currentFrame;
    const entryPath = store.activeFilePath ?? undefined;

    // Build files map from active VFS
    const files: Record<string, string> = {};
    store.files.forEach((file, filePath) => {
      files[filePath] = file.activeCode;
    });

    if (Object.keys(files).length === 0) {
      return { type: "text", text: "No files in VFS — nothing to capture." };
    }

    try {
      const response = await fetch("/api/render/still", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files,
          entryPath,
          compositionId: compositionId ?? "Main",
          frame,
        }),
      });

      if (!response.ok) {
        return {
          type: "text",
          text: `Frame capture failed: render server returned ${response.status}. Continue reasoning from code.`,
        };
      }

      let json: { ok: boolean; data?: string; error?: string };
      try {
        json = (await response.json()) as typeof json;
      } catch {
        return {
          type: "text",
          text: "Frame capture failed: render server returned invalid response. Continue reasoning from code.",
        };
      }

      if (!json.ok || !json.data) {
        return {
          type: "text",
          text: `Frame capture failed: ${json.error ?? "Unknown render error"}. Continue reasoning from code.`,
        };
      }

      return { type: "image", media_type: "image/png", data: json.data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "text",
        text: `Frame capture failed: render server unreachable. ${message}`,
      };
    }
  },
};
