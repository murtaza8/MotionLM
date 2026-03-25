// ---------------------------------------------------------------------------
// Highlight box types and style constants
// ---------------------------------------------------------------------------

export interface HighlightBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Inline style object for the hover highlight ring.
 * Applied when an element is under the cursor in edit mode.
 */
export const HOVER_BORDER = "1.5px solid rgba(59,130,246,0.60)";
export const HOVER_SHADOW = "inset 0 0 0 1px rgba(59,130,246,0.20)";

/**
 * Inline style object for the selection highlight ring.
 * Applied when an element has been clicked and is the active selection.
 */
export const SELECTED_BORDER = "2px solid rgba(59,130,246,0.90)";
export const SELECTED_SHADOW =
  "0 0 0 3px rgba(59,130,246,0.30), inset 0 0 0 1px rgba(59,130,246,0.40)";

// ---------------------------------------------------------------------------
// getHighlightBox
// ---------------------------------------------------------------------------

/**
 * Computes a highlight box for `element` in the coordinate space of
 * `containerRect` (the overlay container on the main page).
 *
 * The element lives inside a Remotion Player iframe. getBoundingClientRect()
 * on an element inside an iframe returns coordinates relative to the iframe's
 * own viewport, not the main page viewport. This function reads the iframe's
 * position on the main page via element.ownerDocument.defaultView.frameElement
 * and adds the necessary offset so the returned box is ready to use as
 * absolute `top`/`left` CSS values inside the overlay div.
 *
 * `scale` is accepted for API completeness — getBoundingClientRect() already
 * accounts for CSS transform scaling (which is how Remotion Player scales the
 * 1920×1080 composition to fit the container), so no manual multiplication
 * is needed when scale=1.
 */
export const getHighlightBox = (
  element: HTMLElement,
  containerRect: DOMRect,
  scale: number
): HighlightBox => {
  const elementRect = element.getBoundingClientRect();

  // Resolve the <iframe> that owns this element so we can map its viewport
  // coords to the main page viewport.
  const frameElement = element.ownerDocument.defaultView?.frameElement;
  const iframeRect =
    frameElement instanceof HTMLElement
      ? frameElement.getBoundingClientRect()
      : new DOMRect();

  return {
    top: iframeRect.top - containerRect.top + elementRect.top,
    left: iframeRect.left - containerRect.left + elementRect.left,
    width: elementRect.width * scale,
    height: elementRect.height * scale,
  };
};
