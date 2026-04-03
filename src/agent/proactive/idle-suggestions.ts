import type { TemporalMap } from "@/engine/temporal/types";
import type { EditSuggestion } from "./post-edit-analyzer";

// Re-export so callers can import EditSuggestion from either module.
export type { EditSuggestion };

// ---------------------------------------------------------------------------
// analyzeForIdleSuggestions — fires after 10s of user inactivity
// ---------------------------------------------------------------------------

/**
 * Returns at most 1 suggestion per call. Uses a deterministic rotation based
 * on (Date.now() / 30000 | 0) % 3 to cycle through checks without pure randomness.
 */
export function analyzeForIdleSuggestions(
  temporalMap: TemporalMap | null,
  currentCode: string,
  durationInFrames: number
): EditSuggestion[] {
  const checkIndex = (Date.now() / 30000 | 0) % 3;

  const checks: Array<
    (
      temporalMap: TemporalMap | null,
      currentCode: string,
      durationInFrames: number
    ) => EditSuggestion | null
  > = [
    checkNoExitAnimations,
    checkFrontLoadedTiming,
    checkSingleLargeFile,
  ];

  try {
    const suggestion = checks[checkIndex](temporalMap, currentCode, durationInFrames);
    if (suggestion !== null) return [suggestion];
  } catch {
    // never throw from analyzer
  }

  return [];
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkNoExitAnimations(
  temporalMap: TemporalMap | null,
  currentCode: string,
  durationInFrames: number
): EditSuggestion | null {
  try {
    const lastSectionStart = Math.floor(durationInFrames * 0.8);

    // Check temporal map for opacity animations going to 0 in last 20%
    if (temporalMap !== null) {
      for (const node of temporalMap.nodes.values()) {
        for (const anim of node.animations) {
          if (
            anim.property === "opacity" &&
            anim.valueRange[1] === 0 &&
            anim.frameRange[1] >= lastSectionStart
          ) {
            return null; // exit animation already exists
          }
        }
      }
    }

    // Also check code for fade-out patterns in the last 20% of lines
    const lines = currentCode.split("\n");
    const lastSectionLine = Math.floor(lines.length * 0.8);
    const lastSectionCode = lines.slice(lastSectionLine).join("\n");
    if (/opacity.*[^1]0|fade[Oo]ut|fadeOut/i.test(lastSectionCode)) {
      return null;
    }

    return {
      id: crypto.randomUUID(),
      type: "idle",
      message:
        "No exit animations detected. Add fade-outs for a polished finish?",
      applyInstruction:
        "Add fade-out exit animations to all top-level sequences",
    };
  } catch {
    return null;
  }
}

function checkFrontLoadedTiming(
  temporalMap: TemporalMap | null,
  _currentCode: string,
  durationInFrames: number
): EditSuggestion | null {
  try {
    if (temporalMap === null) return null;

    const threshold = durationInFrames * 0.3;
    const nodes = [...temporalMap.nodes.values()].filter(
      (n) => n.activeFrameRange !== null
    );

    if (nodes.length === 0) return null;

    const allFrontLoaded = nodes.every(
      (n) => n.activeFrameRange !== null && n.activeFrameRange[0] <= threshold
    );

    if (!allFrontLoaded) return null;

    return {
      id: crypto.randomUUID(),
      type: "idle",
      message:
        "All elements start in the first third of the composition. Consider staggering entrances?",
      applyInstruction:
        "Stagger the entrance animations across the full composition duration",
    };
  } catch {
    return null;
  }
}

function checkSingleLargeFile(
  _temporalMap: TemporalMap | null,
  currentCode: string,
  _durationInFrames: number
): EditSuggestion | null {
  try {
    const lineCount = currentCode.split("\n").length;
    if (lineCount <= 150) return null;

    return {
      id: crypto.randomUUID(),
      type: "idle",
      message:
        "This file is getting long. Consider extracting sub-components?",
      applyInstruction:
        "Refactor this composition to extract reusable sub-components into separate files",
    };
  } catch {
    return null;
  }
}
