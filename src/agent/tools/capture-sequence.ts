import { z } from "zod";
import { useStore } from "@/store";

import type { AgentTool, ToolResult } from "./types";

const MAX_FRAMES = 4;
const FRAME_WIDTH = 854;
const FRAME_HEIGHT = 480;

const InputSchema = z.object({
  frames: z.array(z.number().int().min(0)).min(1).max(MAX_FRAMES),
  label: z.string().optional(),
});

/**
 * Fetches a single still frame from the render server.
 * Returns the base64 PNG string or null on failure.
 */
async function fetchStill(
  files: Record<string, string>,
  entryPath: string | undefined,
  compositionId: string,
  frame: number
): Promise<string | null> {
  try {
    const response = await fetch("/api/render/still", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, entryPath, compositionId, frame }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { ok: boolean; data?: string };
    return json.ok && json.data ? json.data : null;
  } catch {
    return null;
  }
}

/**
 * Decodes a base64 PNG string to an ImageBitmap using a Blob intermediary.
 */
async function base64ToImageBitmap(base64: string): Promise<ImageBitmap> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "image/png" });
  return createImageBitmap(blob);
}

export const captureSequenceTool: AgentTool = {
  name: "capture_sequence",
  description:
    "Render multiple frames as a 2x2 filmstrip image. Only call this when the user explicitly asks to preview animation timing or see multiple frames. Do NOT call proactively — the user sees the live preview. Maximum 4 frames.",
  input_schema: {
    type: "object",
    properties: {
      frames: {
        type: "array",
        items: { type: "number" },
        description: "List of frame numbers to capture (1–4 frames).",
        maxItems: MAX_FRAMES,
      },
      label: {
        type: "string",
        description: "Optional label for the filmstrip (not rendered, for context only).",
      },
    },
    required: ["frames"],
  },
  execute: async (input: unknown): Promise<ToolResult> => {
    const { frames } = InputSchema.parse(input);
    const capped = frames.slice(0, MAX_FRAMES);

    const store = useStore.getState();
    const entryPath = store.activeFilePath ?? undefined;

    const files: Record<string, string> = {};
    store.files.forEach((file, filePath) => {
      files[filePath] = file.activeCode;
    });

    if (Object.keys(files).length === 0) {
      return { type: "text", text: "No files in VFS — nothing to capture." };
    }

    // Render all frames in parallel
    const base64Results = await Promise.all(
      capped.map((frame) => fetchStill(files, entryPath, "Main", frame))
    );

    const valid = base64Results.filter((r): r is string => r !== null);
    if (valid.length === 0) {
      return {
        type: "text",
        text: "All frame captures failed. Render server may be unreachable.",
      };
    }

    // Stitch into a 2-column grid using OffscreenCanvas
    try {
      const cols = Math.min(valid.length, 2);
      const rows = Math.ceil(valid.length / 2);
      const canvas = new OffscreenCanvas(FRAME_WIDTH * cols, FRAME_HEIGHT * rows);
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        // OffscreenCanvas not available — return first frame only
        return { type: "image", media_type: "image/png", data: valid[0] };
      }

      const bitmaps = await Promise.all(valid.map(base64ToImageBitmap));

      for (let i = 0; i < bitmaps.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        ctx.drawImage(bitmaps[i], col * FRAME_WIDTH, row * FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT);
        bitmaps[i].close();
      }

      const blob = await canvas.convertToBlob({ type: "image/png" });
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // btoa with chunked string to avoid stack overflow on large buffers
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const data = btoa(binary);

      return { type: "image", media_type: "image/png", data };
    } catch {
      // Fallback: return first successfully captured frame
      return { type: "image", media_type: "image/png", data: valid[0] };
    }
  },
};
