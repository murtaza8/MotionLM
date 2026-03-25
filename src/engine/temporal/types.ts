// ---------------------------------------------------------------------------
// Temporal engine types
// ---------------------------------------------------------------------------

/**
 * Describes a single animation on a JSX element — either a statically-resolved
 * interpolate/spring call or a dynamic expression that could not be evaluated.
 */
export interface AnimationDescriptor {
  /** The style property this animation drives, e.g. 'opacity', 'translateY'. */
  property: string;
  type: "interpolate" | "spring" | "dynamic";
  /** Absolute frame range this animation is active over, in composition frames. */
  frameRange: [number, number];
  /** Output value range (for interpolate) or [0,1] placeholder for spring/dynamic. */
  valueRange: [number, number];
  /** Easing config pulled from the interpolate options object, if present. */
  easing?: {
    extrapolateLeft?: string;
    extrapolateRight?: string;
  };
  /** Spring config extracted from the spring() call config argument. */
  springConfig?: {
    damping?: number;
    stiffness?: number;
    mass?: number;
    overshootClamping?: boolean;
  };
  /** Raw source text of the expression (always populated). */
  sourceExpression: string;
}

/**
 * Represents a single JSX element in the composition's source tree, enriched
 * with temporal context: which frames it is visible, what animations it has,
 * and where it sits in the Sequence hierarchy.
 */
export interface TemporalNode {
  /** Unique identifier: `componentName:lineNumber` */
  id: string;
  /** [startLine, endLine] in the source file. */
  sourceRange: [number, number];
  /** Name of the JSX element, e.g. 'AbsoluteFill', 'h1', 'Sequence'. */
  componentName: string;
  /**
   * Absolute frame range during which this element is rendered.
   * null means it is always visible (no Sequence ancestor).
   */
  activeFrameRange: [number, number] | null;
  /** All animations detected on or within this element. */
  animations: AnimationDescriptor[];
  /**
   * Ordered list of ancestor Sequence ids from outermost to innermost.
   * Empty array if the element has no Sequence ancestor.
   */
  sequencePath: string[];
}

/**
 * The complete temporal representation of a Remotion composition source file.
 */
export interface TemporalMap {
  /** All JSX elements keyed by their node id. */
  nodes: Map<string, TemporalNode>;
  /** Total duration of the composition in frames. */
  compositionDuration: number;
  /** Frames per second. */
  fps: number;
}
