import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, Wrench } from "lucide-react";

import { useStore } from "@/store";
import { AgentState } from "@/agent/types";

// ---------------------------------------------------------------------------
// ThinkingIndicator
// ---------------------------------------------------------------------------

/**
 * Pulsing indicator during agent execution. Shows the current tool being
 * executed. Clickable to expand a read-only "Agent Reasoning" view of the
 * think tool log (collapsed by default).
 */
export const ThinkingIndicator = () => {
  const agentState = useStore((s) => s.agentState);
  const pendingToolCalls = useStore((s) => s.pendingToolCalls);
  const thinkLog = useStore((s) => s.thinkLog);
  const [expanded, setExpanded] = useState(false);

  const isActive =
    agentState === AgentState.THINKING || agentState === AgentState.TOOL_CALL;

  if (!isActive && thinkLog.length === 0) return null;

  const statusLabel =
    agentState === AgentState.TOOL_CALL && pendingToolCalls.length > 0
      ? `Running tool...`
      : agentState === AgentState.THINKING
        ? "Thinking..."
        : null;

  return (
    <div className="flex flex-col gap-1">
      {/* Status row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded glass-hover text-left w-full"
      >
        {isActive && (
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
          </span>
        )}

        {!isActive && <Brain className="w-3 h-3 text-[var(--text-tertiary)]" />}

        {statusLabel !== null && (
          <span className="text-[10px] text-[var(--text-secondary)]">
            {statusLabel}
          </span>
        )}

        {thinkLog.length > 0 && (
          <>
            <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">
              {thinkLog.length} thought{thinkLog.length !== 1 ? "s" : ""}
            </span>
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-[var(--text-tertiary)]" />
            ) : (
              <ChevronRight className="w-3 h-3 text-[var(--text-tertiary)]" />
            )}
          </>
        )}
      </button>

      {/* Expanded think log */}
      {expanded && thinkLog.length > 0 && (
        <div className="ml-2 flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
          {thinkLog.map((thought, i) => (
            <div
              key={i}
              className="glass-well rounded p-2 text-[10px] text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-words leading-relaxed"
            >
              <Wrench className="w-2.5 h-2.5 inline mr-1 text-[var(--text-tertiary)]" />
              {thought}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
