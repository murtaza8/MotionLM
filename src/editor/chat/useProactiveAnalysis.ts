import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { useStore } from "@/store";
import { AgentState } from "@/agent/types";
import { analyzeAfterEdit } from "@/agent/proactive/post-edit-analyzer";
import { analyzeForIdleSuggestions } from "@/agent/proactive/idle-suggestions";

const MAX_SUGGESTIONS = 4;

// ---------------------------------------------------------------------------
// useProactiveAnalysis
// ---------------------------------------------------------------------------

/**
 * Wires post-edit and idle-time heuristic analysis to the agent store.
 * Call once inside AgentChat — no return value.
 */
export const useProactiveAnalysis = (): void => {
  const { agentState, activeFilePath, conversationHistoryLength } = useStore(
    useShallow((s) => ({
      agentState: s.agentState,
      activeFilePath: s.activeFilePath,
      conversationHistoryLength: s.conversationHistory.length,
    }))
  );

  const prevAgentStateRef = useRef<AgentState>(agentState);

  // Track last interaction time for idle detection
  const lastInteractionRef = useRef<number>(Date.now());

  // Derived boolean so idle timer effect only fires on IDLE entry/exit,
  // not on every THINKING -> TOOL_CALL -> COMPLETE transition.
  const isIdle = agentState === AgentState.IDLE;

  // -------------------------------------------------------------------
  // Post-edit analysis: fires when agentState transitions to COMPLETE
  // -------------------------------------------------------------------
  useEffect(() => {
    const prev = prevAgentStateRef.current;
    prevAgentStateRef.current = agentState;

    if (prev !== AgentState.COMPLETE && agentState === AgentState.COMPLETE) {
      // Reset idle timer on agent completion
      lastInteractionRef.current = Date.now();

      const state = useStore.getState();
      const activeFile = state.activeFilePath
        ? state.files.get(state.activeFilePath)
        : null;
      const code = activeFile?.activeCode ?? "";

      try {
        const newSuggestions = analyzeAfterEdit(
          code,
          state.temporalMap,
          state.currentFrame
        );

        if (newSuggestions.length === 0) return;

        const existing = state.proactiveSuggestions;

        // Deduplicate by type — don't surface the same type twice
        const existingTypes = new Set(existing.map((s) => s.type));
        const deduped = newSuggestions.filter(
          (s) => !existingTypes.has(s.type)
        );

        if (deduped.length === 0) return;

        // Merge with existing, cap at MAX_SUGGESTIONS (drop oldest on overflow)
        const merged = [...existing, ...deduped].slice(-MAX_SUGGESTIONS);
        state.setProactiveSuggestions(merged);
      } catch {
        // never throw from proactive analysis
      }
    }
  }, [agentState]);

  // -------------------------------------------------------------------
  // Idle analysis: fires when agentState is IDLE and no interaction for 10s
  // -------------------------------------------------------------------
  useEffect(() => {
    // Reset last interaction time whenever activeFilePath or history length changes
    lastInteractionRef.current = Date.now();
  }, [activeFilePath, conversationHistoryLength]);

  useEffect(() => {
    if (!isIdle) return;

    const timer = setTimeout(() => {
      // Re-check state is still IDLE inside the callback
      const state = useStore.getState();
      if (state.agentState !== AgentState.IDLE) return;

      // Re-check that 10s have elapsed since last interaction
      if (Date.now() - lastInteractionRef.current < 10_000) return;

      const activeFile = state.activeFilePath
        ? state.files.get(state.activeFilePath)
        : null;
      const code = activeFile?.activeCode ?? "";

      try {
        const idleSuggestions = analyzeForIdleSuggestions(
          state.temporalMap,
          code,
          state.durationInFrames
        );

        if (idleSuggestions.length === 0) return;

        // Filter: "single large file" check only applies when there is one file
        const filtered = idleSuggestions.filter((s) => {
          if (
            s.applyInstruction.includes("sub-components") &&
            state.files.size > 1
          ) {
            return false;
          }
          return true;
        });

        if (filtered.length === 0) return;

        const existing = state.proactiveSuggestions;

        // Deduplicate by type
        const existingTypes = new Set(existing.map((s) => s.type));
        const deduped = filtered.filter((s) => !existingTypes.has(s.type));

        if (deduped.length === 0) return;

        const merged = [...existing, ...deduped].slice(-MAX_SUGGESTIONS);
        state.setProactiveSuggestions(merged);
      } catch {
        // never throw from proactive analysis
      }
    }, 10_000);

    return () => clearTimeout(timer);
  }, [isIdle]);
};
