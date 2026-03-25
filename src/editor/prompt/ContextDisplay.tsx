import { useStore } from "@/store";

export const ContextDisplay = () => {
  const selectedElementId = useStore((s) => s.selectedElementId);
  const selectedFrame = useStore((s) => s.selectedFrame);
  const temporalMap = useStore((s) => s.temporalMap);
  const durationInFrames = useStore((s) => s.durationInFrames);

  if (!selectedElementId || selectedFrame === null) {
    return (
      <span className="text-xs text-[var(--text-tertiary)]">
        No element selected — editing full file
      </span>
    );
  }

  const node = temporalMap?.nodes.get(selectedElementId);
  if (!node) {
    return (
      <span className="text-xs text-[var(--text-tertiary)]">
        No element selected — editing full file
      </span>
    );
  }

  const sequenceName =
    node.sequencePath.length > 0
      ? node.sequencePath[node.sequencePath.length - 1]
      : null;

  const firstAnimation = node.animations[0];
  const animationState = firstAnimation
    ? `${firstAnimation.property} ${firstAnimation.type}`
    : null;

  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
      </span>
      <span className="text-xs text-[var(--text-secondary)] truncate">
        {node.componentName}
        {sequenceName !== null ? ` in ${sequenceName}` : ""}
        {`, frame ${selectedFrame}/${durationInFrames}`}
        {animationState !== null ? `, ${animationState}` : ""}
      </span>
    </div>
  );
};
