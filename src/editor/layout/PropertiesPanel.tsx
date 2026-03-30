import { useStore } from "@/store";
import type { AnimationDescriptor, TemporalNode } from "@/engine/temporal/types";
import { X } from "lucide-react";

// ---------------------------------------------------------------------------
// Animation row
// ---------------------------------------------------------------------------

const AnimationRow = ({ anim }: { anim: AnimationDescriptor }) => {
  const typeLabel =
    anim.type === "interpolate"
      ? "interpolate"
      : anim.type === "spring"
      ? "spring"
      : "dynamic";

  return (
    <div className="glass-well rounded p-2 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-primary)]">
          {anim.property}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--glass-bg-1)] text-[var(--text-tertiary)] font-mono">
          {typeLabel}
        </span>
      </div>

      <div className="text-[10px] text-[var(--text-secondary)] font-mono">
        frames {anim.frameRange[0]}–{anim.frameRange[1]}
        {anim.type !== "dynamic" && (
          <span className="ml-2">
            values {anim.valueRange[0]}–{anim.valueRange[1]}
          </span>
        )}
      </div>

      {anim.type === "spring" && anim.springConfig && (
        <div className="text-[10px] text-[var(--text-tertiary)] font-mono flex gap-2 flex-wrap">
          {anim.springConfig.damping !== undefined && (
            <span>damping {anim.springConfig.damping}</span>
          )}
          {anim.springConfig.stiffness !== undefined && (
            <span>stiffness {anim.springConfig.stiffness}</span>
          )}
          {anim.springConfig.mass !== undefined && (
            <span>mass {anim.springConfig.mass}</span>
          )}
        </div>
      )}

      {anim.type === "dynamic" && (
        <div className="text-[10px] text-[var(--text-tertiary)] font-mono break-all leading-relaxed">
          {anim.sourceExpression}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Element section
// ---------------------------------------------------------------------------

const ElementSection = ({
  node,
  selectedFrame,
}: {
  node: TemporalNode;
  selectedFrame: number;
}) => {
  let frameRangeLabel: string;
  let positionLabel: string | null = null;

  if (node.activeFrameRange === null) {
    frameRangeLabel = "Always visible";
  } else {
    const [start, end] = node.activeFrameRange;
    frameRangeLabel = `${start}–${end}`;
    const span = end - start;
    const pct = span > 0 ? Math.round(((selectedFrame - start) / span) * 100) : 0;
    const clamped = Math.max(0, Math.min(100, pct));
    positionLabel = `Frame ${selectedFrame} — ${clamped}% through active range`;
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Component name */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
          Component
        </span>
        <span className="text-sm font-medium text-[var(--text-primary)] font-mono">
          {node.componentName}
        </span>
      </div>

      {/* Source range */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
          Source lines
        </span>
        <span className="text-xs text-[var(--text-secondary)] font-mono">
          {node.sourceRange[0]}–{node.sourceRange[1]}
        </span>
      </div>

      {/* Active frame range */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
          Active frames
        </span>
        <span className="text-xs text-[var(--text-secondary)] font-mono">
          {frameRangeLabel}
        </span>
        {positionLabel && (
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {positionLabel}
          </span>
        )}
      </div>

      {/* Animations */}
      {node.animations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
            Animations ({node.animations.length})
          </span>
          {node.animations.map((anim, i) => (
            <AnimationRow key={i} anim={anim} />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// PropertiesPanel
// ---------------------------------------------------------------------------

export const PropertiesPanel = () => {
  const selectedElementId = useStore((s) => s.selectedElementId);
  const selectedFrame = useStore((s) => s.selectedFrame);
  const temporalMap = useStore((s) => s.temporalMap);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const files = useStore((s) => s.files);

  const discardDraft = useStore((s) => s.discardDraft);

  const activeFile = activeFilePath !== null ? files.get(activeFilePath) : undefined;
  const compilationStatus = activeFile?.compilationStatus ?? "idle";
  const compilationError = activeFile?.compilationError ?? null;
  const hasDraft = activeFile?.draftCode !== null && activeFile?.draftCode !== undefined;

  const node =
    selectedElementId !== null && temporalMap !== null
      ? (temporalMap.nodes.get(selectedElementId) ?? null)
      : null;

  // When an element is selected but not in the temporal map, extract basic
  // info from the element ID format "{componentName}:{lineNumber}".
  const fallbackSelection =
    selectedElementId !== null && node === null
      ? (() => {
          const colonIdx = selectedElementId.lastIndexOf(":");
          const componentName =
            colonIdx !== -1 ? selectedElementId.slice(0, colonIdx) : selectedElementId;
          const line =
            colonIdx !== -1 ? parseInt(selectedElementId.slice(colonIdx + 1), 10) : 0;
          return { componentName, line: Number.isFinite(line) ? line : 0 };
        })()
      : null;

  const statusColor =
    compilationStatus === "success"
      ? "text-emerald-400"
      : compilationStatus === "error"
      ? "text-red-400"
      : compilationStatus === "compiling"
      ? "text-amber-400"
      : "text-[var(--text-tertiary)]";

  return (
    <div className="glass-panel border-l border-[var(--glass-border-subtle)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--glass-border-subtle)] flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium uppercase tracking-widest text-[var(--text-tertiary)]">
          Properties
        </span>
        <span className={`text-[10px] font-mono ${statusColor}`}>
          {compilationStatus}
        </span>
      </div>

      {/* Draft error state */}
      {compilationError !== null && (
        <div className="mx-3 mt-3 flex-shrink-0 glass-well glass-tint-red rounded p-2 flex flex-col gap-2">
          <pre className="text-[10px] font-mono text-red-300 whitespace-pre-wrap break-all leading-relaxed">
            {compilationError}
          </pre>
          {hasDraft && activeFilePath !== null && (
            <div className="flex gap-1.5 justify-end">
              <button
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--text-secondary)] glass-well hover:glass-tint-red transition-colors"
                onClick={() => discardDraft(activeFilePath)}
              >
                <X size={10} />
                Discard
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pending draft indicator (compiling) */}
      {hasDraft && compilationStatus === "compiling" && compilationError === null && (
        <div className="mx-3 mt-3 flex-shrink-0 glass-well glass-tint-amber rounded p-2">
          <span className="text-[10px] text-amber-300">Applying edit...</span>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {node !== null && selectedFrame !== null ? (
          <ElementSection node={node} selectedFrame={selectedFrame} />
        ) : fallbackSelection !== null ? (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
                Element
              </span>
              <span className="text-sm font-medium text-[var(--text-primary)] font-mono">
                {fallbackSelection.componentName}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
                Source line
              </span>
              <span className="text-xs text-[var(--text-secondary)] font-mono">
                {fallbackSelection.line}
              </span>
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
              No animation data. Open Cmd+K to edit this element.
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full px-4">
            <span className="text-xs text-[var(--text-tertiary)] text-center leading-relaxed">
              Select an element to inspect
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
