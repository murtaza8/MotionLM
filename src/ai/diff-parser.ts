import { compileComposition } from "@/engine/compiler";
import { EditResponseSchema } from "@/ai/client";
import { sendEditRequest } from "@/ai/client";

import type { EditResponse, StreamChunk, Message } from "@/ai/client";
import type { VFSFile } from "@/store";

// ---------------------------------------------------------------------------
// Store actions surface — passed in by the caller so this module stays
// independent of the React/Zustand hook layer
// ---------------------------------------------------------------------------

export interface StoreEditActions {
  setDraftCode: (path: string, code: string) => void;
  setCompilationStatus: (
    path: string,
    status: VFSFile["compilationStatus"],
    error?: string
  ) => void;
  promoteDraft: (path: string) => void;
  discardDraft: (path: string) => void;
  pushSnapshot: (description: string) => void;
}

// ---------------------------------------------------------------------------
// parseEditResponse
// ---------------------------------------------------------------------------

/**
 * Parses Claude's raw text response into an EditResponse.
 * Handles:
 *  - Bare JSON
 *  - JSON wrapped in markdown code fences (```json ... ``` or ``` ... ```)
 *  - Extra prose before/after the JSON object
 */
export function parseEditResponse(
  rawResponse: string
): { ok: true; edit: EditResponse } | { ok: false; error: string } {
  const candidate = extractJson(rawResponse);
  if (candidate === null) {
    return { ok: false, error: "No JSON object found in Claude response." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ok: false, error: "Failed to parse JSON from Claude response." };
  }

  const result = EditResponseSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join(", ");
    return {
      ok: false,
      error: `Claude response did not match expected shape: ${issues}`,
    };
  }

  return { ok: true, edit: result.data };
}

/**
 * Extracts the first complete JSON object from a string.
 * Strips markdown code fences first, then scans for `{...}`.
 */
function extractJson(text: string): string | null {
  // Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const stripped = fenceMatch ? fenceMatch[1].trim() : text;

  // Find the outermost { ... } block
  const start = stripped.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Stream collector
// ---------------------------------------------------------------------------

async function collectStream(
  stream: AsyncGenerator<StreamChunk>
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let text = "";
  for await (const chunk of stream) {
    if (chunk.type === "text_delta") {
      text += chunk.text;
    } else if (chunk.type === "error") {
      return { ok: false, error: chunk.error };
    }
  }
  return { ok: true, text };
}

// ---------------------------------------------------------------------------
// Retry prompt builder
// ---------------------------------------------------------------------------

function buildRetryMessages(
  originalMessages: Message[],
  failedEdit: EditResponse,
  compileError: string
): Message[] {
  // Mirror the full response shape Claude originally produced so the retry
  // conversation is coherent.
  const assistantTurn: Message = {
    role: "assistant",
    content: JSON.stringify(failedEdit),
  };

  const retryTurn: Message = {
    role: "user",
    content: [
      "The code you returned failed to compile with the following error:",
      "",
      compileError,
      "",
      "Please fix the error and return the corrected file using the same JSON format.",
      "Return the complete corrected file contents — do not truncate.",
    ].join("\n"),
  };

  return [...originalMessages, assistantTurn, retryTurn];
}

// ---------------------------------------------------------------------------
// applyEdit
// ---------------------------------------------------------------------------

const MAX_RETRIES = 2;

export async function applyEdit(params: {
  edit: EditResponse;
  apiKey: string;
  model: string;
  /** Original messages sent to produce this edit — used to build retry context. */
  messages: Message[];
  store: StoreEditActions;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { store } = params;
  let currentEdit = params.edit;
  let currentMessages = params.messages;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Write draft
    store.setDraftCode(currentEdit.file, currentEdit.code);
    store.setCompilationStatus(currentEdit.file, "compiling");

    // Attempt compilation
    const compileResult = compileComposition(currentEdit.code);

    if (compileResult.ok) {
      // Success: push history before promoting so the pre-edit state is saved
      store.pushSnapshot(
        currentEdit.explanation.length > 0
          ? currentEdit.explanation
          : "Claude edit"
      );
      store.promoteDraft(currentEdit.file);
      store.setCompilationStatus(currentEdit.file, "success");
      return { ok: true };
    }

    // Compilation failed
    const compileError = compileResult.error;
    store.setCompilationStatus(currentEdit.file, "error", compileError);

    if (attempt >= MAX_RETRIES) break;

    // Build retry conversation and stream a new response
    const retryMessages = buildRetryMessages(
      currentMessages,
      currentEdit,
      compileError
    );

    const retryStream = sendEditRequest(retryMessages, params.apiKey, params.model);
    const collected = await collectStream(retryStream);

    if (!collected.ok) {
      return { ok: false, error: collected.error };
    }

    const parsed = parseEditResponse(collected.text);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    currentEdit = parsed.edit;
    currentMessages = retryMessages;
  }

  return {
    ok: false,
    error: `Compilation failed after ${MAX_RETRIES + 1} attempts. Draft is available for manual inspection.`,
  };
}
