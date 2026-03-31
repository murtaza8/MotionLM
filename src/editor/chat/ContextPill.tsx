import { AtSign } from "lucide-react";

import { useStore } from "@/store";

// ---------------------------------------------------------------------------
// ContextPill
// ---------------------------------------------------------------------------

/**
 * Shows `@ElementName:frameN` when an element is selected in the overlay.
 * Appears inline in the chat input area to give the user visual confirmation
 * of what context is attached to their next message.
 */
export const ContextPill = () => {
  const selectedElementId = useStore((s) => s.selectedElementId);
  const selectedFrame = useStore((s) => s.selectedFrame);

  if (selectedElementId === null) return null;

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full glass-well text-[10px] text-blue-300 font-mono shrink-0">
      <AtSign className="w-2.5 h-2.5" />
      {selectedElementId}
    </span>
  );
};
