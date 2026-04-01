import type { TemporalMap } from "@/engine/temporal/types";

// ---------------------------------------------------------------------------
// EditSuggestion
// ---------------------------------------------------------------------------

export interface EditSuggestion {
  id: string;
  type: "animation-clamp" | "overlap" | "spring-oscillation" | "text-cutoff" | "idle";
  message: string;
  /** Sent to the agent if the user clicks Apply. */
  applyInstruction: string;
  elementId?: string;
  frame?: number;
}

// ---------------------------------------------------------------------------
// analyzeAfterEdit — heuristic checks after every agent edit
// ---------------------------------------------------------------------------

export function analyzeAfterEdit(
  code: string,
  temporalMap: TemporalMap | null,
  currentFrame: number
): EditSuggestion[] {
  const suggestions: EditSuggestion[] = [];

  // Check 1: interpolate() calls missing extrapolation clamping
  try {
    const interpolateRe = /interpolate\s*\(/g;
    let match: RegExpExecArray | null;
    let flagged = false;
    while ((match = interpolateRe.exec(code)) !== null && !flagged) {
      // Grab a generous window after the opening paren to inspect options
      const slice = code.slice(match.index, match.index + 400);
      if (!slice.includes("clamp")) {
        suggestions.push({
          id: crypto.randomUUID(),
          type: "animation-clamp",
          message:
            'interpolate() call is missing extrapolation clamping. Values may jump outside the intended range. Add { extrapolateLeft: "clamp", extrapolateRight: "clamp" }.',
          applyInstruction:
            'Add { extrapolateLeft: "clamp", extrapolateRight: "clamp" } to all interpolate() calls that are missing it',
        });
        flagged = true;
      }
    }
  } catch {
    // never throw from analyzer
  }

  // Check 2: spring() with stiffness > 200 and damping < 20
  try {
    // Match either order: stiffness then damping, or damping then stiffness
    const patterns = [
      /spring\s*\(\s*\{[^}]*stiffness\s*:\s*(\d+(?:\.\d+)?)[^}]*damping\s*:\s*(\d+(?:\.\d+)?)/g,
      /spring\s*\(\s*\{[^}]*damping\s*:\s*(\d+(?:\.\d+)?)[^}]*stiffness\s*:\s*(\d+(?:\.\d+)?)/g,
    ];

    let found = false;
    for (const re of patterns) {
      if (found) break;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null && !found) {
        const a = parseFloat(m[1]);
        const b = parseFloat(m[2]);
        // For first pattern: a=stiffness, b=damping. For second: a=damping, b=stiffness.
        const stiffness = re === patterns[0] ? a : b;
        const damping = re === patterns[0] ? b : a;
        if (stiffness > 200 && damping < 20) {
          suggestions.push({
            id: crypto.randomUUID(),
            type: "spring-oscillation",
            message: `Spring animation may oscillate: stiffness ${stiffness} > 200 with damping ${damping} < 20. Increase damping to avoid bouncing.`,
            applyInstruction:
              "Increase damping to at least 20 on all spring() calls where stiffness > 200 to prevent oscillation",
          });
          found = true;
        }
      }
    }
  } catch {
    // never throw from analyzer
  }

  // Check 3: Sequence ending within 5 frames of total duration (text cutoff risk)
  try {
    if (temporalMap !== null) {
      const totalDuration = temporalMap.compositionDuration;
      for (const node of temporalMap.nodes.values()) {
        if (
          node.componentName === "Sequence" &&
          node.activeFrameRange !== null
        ) {
          const endFrame = node.activeFrameRange[1];
          if (Math.abs(endFrame - totalDuration) <= 5) {
            suggestions.push({
              id: crypto.randomUUID(),
              type: "text-cutoff",
              message: `Sequence ends within 5 frames of the composition end (frame ${endFrame} of ${totalDuration}). Content may be clipped before it finishes.`,
              applyInstruction:
                "Extend the composition duration or shorten the last Sequence so content is not clipped at the boundary",
              elementId: node.id,
              frame: endFrame,
            });
            break;
          }
        }
      }
    }
  } catch {
    // never throw from analyzer
  }

  // Check 4: More than 3 sequences overlapping at currentFrame
  try {
    if (temporalMap !== null) {
      const overlapping = [...temporalMap.nodes.values()].filter((node) => {
        if (node.activeFrameRange === null) return false;
        const [from, to] = node.activeFrameRange;
        return from <= currentFrame && currentFrame <= to;
      });
      if (overlapping.length > 3) {
        suggestions.push({
          id: crypto.randomUUID(),
          type: "overlap",
          message: `${overlapping.length} sequences overlap at frame ${currentFrame}. This may cause visual clutter or z-order issues.`,
          applyInstruction:
            "Review and stagger the overlapping sequences to reduce visual complexity at frame " +
            String(currentFrame),
          frame: currentFrame,
        });
      }
    }
  } catch {
    // never throw from analyzer
  }

  return suggestions;
}
