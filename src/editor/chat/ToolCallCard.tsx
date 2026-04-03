import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus,
  FileSearch,
  FolderOpen,
  CheckCircle,
  XCircle,
  Brain,
  Play,
  Map,
  Info,
  Wrench,
  Camera,
  Film,
} from "lucide-react";

import type { ToolUseContentBlock, ToolResultContentBlock } from "@/agent/types";

// ---------------------------------------------------------------------------
// Tool icon map
// ---------------------------------------------------------------------------

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  think: Brain,
  edit_file: FileCode,
  read_file: FileSearch,
  list_files: FolderOpen,
  create_file: FilePlus,
  check_compilation: CheckCircle,
  seek_to_frame: Play,
  get_temporal_map: Map,
  get_element_info: Info,
  capture_frame: Camera,
  capture_sequence: Film,
};

// ---------------------------------------------------------------------------
// ToolCallCard
// ---------------------------------------------------------------------------

interface ToolCallCardProps {
  toolUse: ToolUseContentBlock;
  toolResult: ToolResultContentBlock | null;
}

export const ToolCallCard = ({ toolUse, toolResult }: ToolCallCardProps) => {
  const [expanded, setExpanded] = useState(false);

  const Icon = TOOL_ICONS[toolUse.name] ?? Wrench;
  const isError = toolResult?.is_error === true;
  const isPending = toolResult === null;

  const inputSummary = summarizeInput(toolUse.name, toolUse.input);
  const outputText = extractOutputText(toolResult);
  const outputImage = extractOutputImage(toolResult);

  return (
    <div
      className={`rounded glass-well ${
        isError ? "glass-tint-red" : ""
      } overflow-hidden`}
    >
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left glass-hover"
      >
        <Icon className="w-3 h-3 text-[var(--text-tertiary)] shrink-0" />

        <span className="text-[10px] font-mono font-medium text-[var(--text-secondary)] truncate">
          {toolUse.name}
        </span>

        {inputSummary && (
          <span className="text-[10px] text-[var(--text-tertiary)] truncate">
            {inputSummary}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1 shrink-0">
          {isPending && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
            </span>
          )}
          {!isPending && !isError && (
            <CheckCircle className="w-3 h-3 text-emerald-400" />
          )}
          {isError && <XCircle className="w-3 h-3 text-red-400" />}

          {expanded ? (
            <ChevronDown className="w-3 h-3 text-[var(--text-tertiary)]" />
          ) : (
            <ChevronRight className="w-3 h-3 text-[var(--text-tertiary)]" />
          )}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[var(--glass-border-subtle)] px-2 py-1.5 flex flex-col gap-1.5">
          {/* Input */}
          {Object.keys(toolUse.input).length > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-widest text-[var(--text-tertiary)]">
                Input
              </span>
              {toolUse.name === "edit_file" || toolUse.name === "create_file" ? (
                <CodeBlock code={String(toolUse.input.code ?? "")} />
              ) : toolUse.name === "check_compilation" ? (
                <CodeBlock code={String(toolUse.input.code ?? "")} />
              ) : (
                <pre className="text-[10px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all leading-relaxed max-h-[120px] overflow-y-auto">
                  {JSON.stringify(toolUse.input, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Output — text */}
          {outputText !== null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-widest text-[var(--text-tertiary)]">
                Output
              </span>
              <pre
                className={`text-[10px] font-mono whitespace-pre-wrap break-all leading-relaxed max-h-[120px] overflow-y-auto ${
                  isError ? "text-red-300" : "text-[var(--text-secondary)]"
                }`}
              >
                {outputText}
              </pre>
            </div>
          )}

          {/* Output — image (capture_frame / capture_sequence) */}
          {outputImage !== null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-widest text-[var(--text-tertiary)]">
                Capture
              </span>
              <img
                src={`data:image/png;base64,${outputImage}`}
                alt="Captured frame"
                className="rounded max-w-full border border-[var(--glass-border-subtle)]"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CodeBlock = ({ code }: { code: string }) => {
  const lines = code.split("\n");
  const preview = lines.length > 12 ? lines.slice(0, 12).join("\n") + "\n..." : code;
  return (
    <pre className="text-[10px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all leading-relaxed max-h-[160px] overflow-y-auto bg-[var(--glass-bg-0)] rounded p-1.5">
      {preview}
    </pre>
  );
};

function summarizeInput(
  toolName: string,
  input: Record<string, unknown>
): string | null {
  switch (toolName) {
    case "edit_file":
    case "read_file":
    case "create_file":
    case "check_compilation":
      return typeof input.path === "string" ? input.path : null;
    case "seek_to_frame":
      return typeof input.frame === "number" ? `frame ${input.frame}` : null;
    case "get_element_info":
      return typeof input.elementId === "string" ? input.elementId : null;
    case "think":
      return typeof input.thought === "string"
        ? input.thought.slice(0, 60) + (input.thought.length > 60 ? "..." : "")
        : null;
    case "capture_frame":
      return typeof input.frame === "number" ? `frame ${input.frame}` : "current frame";
    case "capture_sequence":
      return Array.isArray(input.frames)
        ? `frames ${(input.frames as number[]).join(", ")}`
        : null;
    default:
      return null;
  }
}

function extractOutputText(
  result: ToolResultContentBlock | null
): string | null {
  if (result === null) return null;
  for (const block of result.content) {
    if (block.type === "text") return block.text;
  }
  return null;
}

function extractOutputImage(
  result: ToolResultContentBlock | null
): string | null {
  if (result === null) return null;
  for (const block of result.content) {
    if (block.type === "image") return block.source.data;
  }
  return null;
}
