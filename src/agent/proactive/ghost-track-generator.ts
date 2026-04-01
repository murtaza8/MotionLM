import type { TemporalMap } from "@/engine/temporal/types";
import type { EditSuggestion } from "./post-edit-analyzer";

// ---------------------------------------------------------------------------
// GhostTrack
// ---------------------------------------------------------------------------

export interface GhostTrack {
  id: string;
  label: string;
  startFrame: number;
  endFrame: number;
  /** Lane index below the last real track. */
  track: number;
  suggestion: EditSuggestion;
}

// ---------------------------------------------------------------------------
// generateGhostTracks — pure function, no store access, no React
// ---------------------------------------------------------------------------

export function generateGhostTracks(
  suggestions: EditSuggestion[],
  temporalMap: TemporalMap | null,
  durationInFrames: number
): GhostTrack[] {
  if (temporalMap === null || suggestions.length === 0) return [];

  const tracks: GhostTrack[] = [];
  const baseLane = temporalMap.nodes.size;

  for (const suggestion of suggestions) {
    // animation-clamp and spring-oscillation have no spatial meaning on a timeline
    if (
      suggestion.type === "animation-clamp" ||
      suggestion.type === "spring-oscillation"
    ) {
      continue;
    }

    if (suggestion.type === "idle") {
      // Only produce ghost tracks for no-exit-animation idle suggestions
      // (identified by applyInstruction content)
      if (!suggestion.applyInstruction.includes("fade-out")) continue;

      // One ghost track per top-level sequence node covering the last 20%
      const lastSectionStart = Math.floor(durationInFrames * 0.8);
      let index = 0;
      for (const node of temporalMap.nodes.values()) {
        // Top-level = sequencePath is empty (no Sequence ancestor)
        if (node.sequencePath.length === 0) {
          tracks.push({
            id: `ghost-${suggestion.id}-${index}`,
            label: `Fade out: ${node.componentName}`,
            startFrame: lastSectionStart,
            endFrame: durationInFrames,
            track: baseLane,
            suggestion,
          });
          index++;
        }
      }
      continue;
    }

    if (suggestion.type === "overlap") {
      const frame = suggestion.frame ?? 0;
      tracks.push({
        id: `ghost-${suggestion.id}-0`,
        label: "Overlap zone",
        startFrame: Math.max(0, frame - 5),
        endFrame: Math.min(durationInFrames, frame + 5),
        track: baseLane,
        suggestion,
      });
      continue;
    }

    if (suggestion.type === "text-cutoff") {
      if (suggestion.frame === undefined) continue;
      tracks.push({
        id: `ghost-${suggestion.id}-0`,
        label: "Possible cutoff",
        startFrame: Math.max(0, suggestion.frame - 5),
        endFrame: durationInFrames,
        track: baseLane,
        suggestion,
      });
      continue;
    }
  }

  return tracks;
}
