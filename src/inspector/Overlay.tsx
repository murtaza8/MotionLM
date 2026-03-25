import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "@/store";

import {
  getHighlightBox,
  HOVER_BORDER,
  HOVER_SHADOW,
  SELECTED_BORDER,
  SELECTED_SHADOW,
} from "./highlight";
import type { HighlightBox } from "./highlight";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HoveredElement {
  id: string;
  component: string;
  box: HighlightBox;
}

interface SelectedElement {
  id: string;
  box: HighlightBox;
}

interface Props {
  /** Ref to the container div that wraps both the Player and this Overlay. */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

// ---------------------------------------------------------------------------
// Shared hit-test helper
// ---------------------------------------------------------------------------

/**
 * Pierces through the overlay (by temporarily disabling its pointer-events),
 * finds the element under (clientX, clientY), and walks up the DOM to the
 * nearest ancestor with a data-motionlm-id attribute.
 *
 * Returns the element if found, or null if no labelled ancestor exists.
 */
const hitTestMotionLMElement = (
  clientX: number,
  clientY: number,
  overlayEl: HTMLElement
): HTMLElement | null => {
  overlayEl.style.pointerEvents = "none";
  const hitEl = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  overlayEl.style.pointerEvents = "auto";

  if (!hitEl) return null;

  // Remotion <Player> renders in the main document — hitEl is a composition
  // element directly. If it happens to be an <iframe> (future Remotion mode),
  // pierce into it.
  let target: HTMLElement | null;

  if (hitEl.tagName === "IFRAME") {
    const iframe = hitEl as HTMLIFrameElement;
    if (!iframe.contentDocument) return null;
    const iframeRect = iframe.getBoundingClientRect();
    target = iframe.contentDocument.elementFromPoint(
      clientX - iframeRect.left,
      clientY - iframeRect.top
    ) as HTMLElement | null;
  } else {
    target = hitEl;
  }

  // Walk up to the nearest ancestor with data-motionlm-id.
  while (target && !target.dataset["motionlmId"]) {
    target = target.parentElement;
  }

  if (!target || !target.dataset["motionlmId"]) return null;

  return target;
};

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

/**
 * Transparent div positioned absolutely over the Remotion Player.
 *
 * In edit mode (read from store): intercepts mouse events, hit-tests the
 * composition elements, and renders a blue highlight box + tooltip over the
 * hovered element. Clicked elements get a stronger selection ring that
 * persists until cleared.
 *
 * Outside edit mode: pointer-events:none — the Player controls remain fully
 * interactive.
 */
export const Overlay = ({ containerRef }: Props) => {
  const editMode = useStore((s) => s.editMode);
  const currentFrame = useStore((s) => s.currentFrame);
  const selectedElementId = useStore((s) => s.selectedElementId);
  const setSelection = useStore((s) => s.setSelection);
  const clearSelection = useStore((s) => s.clearSelection);

  const [hovered, setHovered] = useState<HoveredElement | null>(null);
  const [selected, setSelected] = useState<SelectedElement | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Clear hover and selection state when leaving edit mode
  useEffect(() => {
    if (!editMode) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setHovered(null);
      setSelected(null);
    }
  }, [editMode]);

  // Sync selected visual state when store's selectedElementId changes
  // (e.g. auto-cleared when temporal map rebuilds)
  useEffect(() => {
    if (selectedElementId === null) {
      setSelected(null);
    }
  }, [selectedElementId]);

  // Escape key clears selection — active only when editMode is true
  useEffect(() => {
    if (!editMode) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearSelection();
        setSelected(null);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editMode, clearSelection]);

  // Cleanup pending rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const { clientX, clientY } = e;

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        const overlayEl = overlayRef.current;
        const containerEl = containerRef.current;
        if (!overlayEl || !containerEl) return;

        const target = hitTestMotionLMElement(clientX, clientY, overlayEl);

        if (!target) {
          setHovered(null);
          return;
        }

        const containerRect = containerEl.getBoundingClientRect();
        const box = getHighlightBox(target, containerRect, 1);

        setHovered({
          id: target.dataset["motionlmId"]!,
          component: target.dataset["motionlmComponent"] ?? "Unknown",
          box,
        });
      });
    },
    [containerRef]
  );

  const handleMouseLeave = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setHovered(null);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const { clientX, clientY } = e;

      const overlayEl = overlayRef.current;
      const containerEl = containerRef.current;
      if (!overlayEl || !containerEl) return;

      const target = hitTestMotionLMElement(clientX, clientY, overlayEl);

      if (!target) {
        clearSelection();
        setSelected(null);
        return;
      }

      const id = target.dataset["motionlmId"]!;
      const containerRect = containerEl.getBoundingClientRect();
      const box = getHighlightBox(target, containerRect, 1);

      setSelection(id, currentFrame);
      setSelected({ id, box });
    },
    [containerRef, currentFrame, setSelection, clearSelection]
  );

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10"
      style={{ pointerEvents: editMode ? "auto" : "none" }}
      onMouseMove={editMode ? handleMouseMove : undefined}
      onMouseLeave={editMode ? handleMouseLeave : undefined}
      onClick={editMode ? handleClick : undefined}
    >
      {/* Selection ring — persists after mouse leaves */}
      {selected && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: selected.box.top,
            left: selected.box.left,
            width: selected.box.width,
            height: selected.box.height,
            border: SELECTED_BORDER,
            boxShadow: SELECTED_SHADOW,
          }}
        />
      )}

      {/* Hover ring — only shown when hovering a different element than selected */}
      {hovered && hovered.id !== selectedElementId && (
        <>
          <div
            className="absolute pointer-events-none"
            style={{
              top: hovered.box.top,
              left: hovered.box.left,
              width: hovered.box.width,
              height: hovered.box.height,
              border: HOVER_BORDER,
              boxShadow: HOVER_SHADOW,
            }}
          />
          {/* Component name tooltip */}
          <div
            className="absolute pointer-events-none px-1.5 py-0.5 rounded text-xs font-medium"
            style={{
              top: Math.max(0, hovered.box.top - 24),
              left: hovered.box.left,
              background: "rgba(59,130,246,0.90)",
              color: "#fff",
            }}
          >
            {hovered.component}
          </div>
        </>
      )}
    </div>
  );
};
