import { useCallback, useRef } from "react";

import { useStore } from "@/store";
import type { TemporalNode } from "@/engine/temporal/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RULER_HEIGHT = 20;
const ROW_HEIGHT = 24;
const ROW_GAP = 2;
const FRAME_COUNTER_HEIGHT = 20;

const SEQUENCE_COLORS = [
  "rgba(59,130,246,0.35)",
  "rgba(168,85,247,0.35)",
  "rgba(34,197,94,0.35)",
  "rgba(251,146,60,0.35)",
  "rgba(236,72,153,0.35)",
  "rgba(20,184,166,0.35)",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rulerInterval(totalFrames: number): number {
  const candidates = [1, 5, 10, 15, 30, 60, 90, 150, 300, 600];
  return candidates.find((c) => totalFrames / c <= 10) ?? 600;
}

// ---------------------------------------------------------------------------
// TimelinePanel
// ---------------------------------------------------------------------------

export const TimelinePanel = () => {
  const temporalMap = useStore((s) => s.temporalMap);
  const currentFrame = useStore((s) => s.currentFrame);
  const durationInFrames = useStore((s) => s.durationInFrames);
  const selectedElementId = useStore((s) => s.selectedElementId);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);
  const setSelection = useStore((s) => s.setSelection);

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const totalFrames = temporalMap?.compositionDuration ?? durationInFrames;

  // Extract and sort Sequence nodes: shallowest first, then by start frame
  const sequences: TemporalNode[] = temporalMap
    ? [...temporalMap.nodes.values()]
        .filter((n) => n.componentName === "Sequence")
        .sort((a, b) => {
          const depthDiff = a.sequencePath.length - b.sequencePath.length;
          if (depthDiff !== 0) return depthDiff;
          return (a.activeFrameRange?.[0] ?? 0) - (b.activeFrameRange?.[0] ?? 0);
        })
    : [];

  const frameToPercent = (frame: number): number =>
    totalFrames > 0 ? (frame / totalFrames) * 100 : 0;

  const xToFrame = useCallback(
    (clientX: number): number => {
      if (!containerRef.current) return 0;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(ratio * Math.max(0, totalFrames - 1));
    },
    [totalFrames]
  );

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      setCurrentFrame(xToFrame(e.clientX));
    },
    [xToFrame, setCurrentFrame]
  );

  const handlePlayheadMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      isDraggingRef.current = true;

      const onMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        setCurrentFrame(xToFrame(ev.clientX));
      };
      const onUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [xToFrame, setCurrentFrame]
  );

  const handleSequenceClick = useCallback(
    (e: React.MouseEvent, seq: TemporalNode) => {
      e.stopPropagation();
      if (!temporalMap) return;
      const child = [...temporalMap.nodes.values()].find(
        (n) => n.sequencePath.includes(seq.id) && n.componentName !== "Sequence"
      );
      if (child) {
        setSelection(child.id, currentFrame);
      }
    },
    [temporalMap, currentFrame, setSelection]
  );

  const interval = rulerInterval(totalFrames);
  const rulerTicks: number[] = [];
  for (let f = 0; f <= totalFrames; f += interval) {
    rulerTicks.push(f);
  }

  const tracksHeight =
    sequences.length > 0
      ? (Math.max(...sequences.map((s) => s.sequencePath.length)) + 1) *
        (ROW_HEIGHT + ROW_GAP)
      : 0;

  return (
    <div className="glass-elevated h-[160px] border-t border-[var(--glass-border-subtle)] flex flex-col overflow-hidden">
      {/* Tracks + ruler */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden cursor-crosshair select-none"
        onClick={handleContainerClick}
      >
        {/* Ruler */}
        <div
          className="absolute top-0 left-0 right-0 border-b border-[var(--glass-border-subtle)]"
          style={{ height: RULER_HEIGHT }}
        >
          {rulerTicks.map((f) => (
            <div
              key={f}
              className="absolute flex flex-col items-center"
              style={{ left: `${frameToPercent(f)}%` }}
            >
              <div className="w-px h-2 bg-[var(--glass-border-default)] mt-1" />
              <span className="text-[9px] text-[var(--text-tertiary)] tabular-nums leading-none mt-0.5">
                {f}
              </span>
            </div>
          ))}
        </div>

        {/* Sequence bars */}
        <div
          className="absolute left-0 right-0"
          style={{ top: RULER_HEIGHT, height: tracksHeight }}
        >
          {sequences.map((seq, i) => {
            const from = seq.activeFrameRange?.[0] ?? 0;
            const to = seq.activeFrameRange?.[1] ?? totalFrames;
            const duration = to - from;
            const depth = seq.sequencePath.length;
            const isSelected = selectedElementId === seq.id;
            const color = SEQUENCE_COLORS[i % SEQUENCE_COLORS.length];
            // Label: extract line number from "Sequence:N"
            const lineNum = seq.id.split(":")[1] ?? "";
            const label = lineNum ? `Seq :${lineNum}` : "Sequence";

            return (
              <div
                key={seq.id}
                className={`absolute rounded overflow-hidden flex items-center px-1.5 ${
                  isSelected ? "glass-well glass-tint-blue" : "glass-well"
                }`}
                style={{
                  left: `${frameToPercent(from)}%`,
                  width: `${frameToPercent(duration)}%`,
                  top: depth * (ROW_HEIGHT + ROW_GAP),
                  height: ROW_HEIGHT,
                  backgroundColor: isSelected ? undefined : color,
                  minWidth: 4,
                }}
                onClick={(e) => handleSequenceClick(e, seq)}
                title={`${label} — frames ${from}–${to}`}
              >
                <span className="text-[10px] text-[var(--text-primary)] truncate leading-none pointer-events-none">
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {sequences.length === 0 && (
          <div
            className="absolute left-0 right-0 flex items-center justify-center"
            style={{ top: RULER_HEIGHT, height: `calc(100% - ${RULER_HEIGHT + FRAME_COUNTER_HEIGHT}px)` }}
          >
            <span className="text-xs text-[var(--text-tertiary)]">
              No sequences — {totalFrames} frames total
            </span>
          </div>
        )}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 z-10 pointer-events-none"
          style={{ left: `${frameToPercent(currentFrame)}%` }}
        >
          <div className="w-px h-full bg-red-400 opacity-90" />
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-400 rounded-sm cursor-ew-resize pointer-events-auto"
            onMouseDown={handlePlayheadMouseDown}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {/* Frame counter */}
      <div
        className="flex items-center justify-between px-3 border-t border-[var(--glass-border-subtle)]"
        style={{ height: FRAME_COUNTER_HEIGHT }}
      >
        <span className="text-[10px] text-[var(--text-tertiary)]">
          {sequences.length > 0
            ? `${sequences.length} sequence${sequences.length !== 1 ? "s" : ""}`
            : "No sequences"}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
          {currentFrame} / {Math.max(0, totalFrames - 1)}
        </span>
      </div>
    </div>
  );
};
