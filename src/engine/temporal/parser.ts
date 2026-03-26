import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

import type { AnimationDescriptor, TemporalMap, TemporalNode } from "./types";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SequenceFrame {
  id: string;
  from: number;
  durationInFrames: number;
  /** Absolute start frame in the composition timeline. */
  absoluteFrom: number;
}

/**
 * Animation call collected in pass 1 before nodes exist.
 * We record the enclosing function name so we can match to JSX nodes later.
 */
interface PendingAnimation {
  descriptor: AnimationDescriptor;
  /** Name of the function/component that contains this call. */
  enclosingFnName: string | null;
  /** Absolute start line of the call expression. */
  callLine: number;
}

/**
 * Per-function-scope tracking of useCurrentFrame() bindings and
 * variables derived from them (e.g. const localFrame = frame - 30).
 */
interface FrameBindingScope {
  /** Variable name bound to useCurrentFrame(). */
  frameVar: string;
  /**
   * Map from derived variable name to numeric offset relative to frameVar.
   * null means the offset is non-statically evaluable (e.g. frame - propValue).
   */
  derivedVars: Map<string, number | null>;
}

interface ParserState {
  /** Built in pass 1 (JSX traversal). */
  nodes: Map<string, TemporalNode>;
  /** Maps node id → enclosing function name (populated during pass 1). */
  nodeToFunction: Map<string, string | null>;
  /** Collected in pass 1, matched to nodes in post-processing. */
  pendingAnimations: PendingAnimation[];
  sequenceStack: SequenceFrame[];
  /** Maps variable name → absolute numeric value. */
  numericBindings: Map<string, number>;
  sequenceCounter: number;
  /** Per-function-scope frame variable bindings. Key is enclosing function name (null = module scope). */
  frameBindings: Map<string | null, FrameBindingScope>;
}

// ---------------------------------------------------------------------------
// Static expression evaluator
// ---------------------------------------------------------------------------

const evalNumeric = (
  node:
    | t.Expression
    | t.SpreadElement
    | t.JSXNamespacedName
    | t.ArgumentPlaceholder
    | null
    | undefined,
  bindings: Map<string, number>
): number | null => {
  if (!node) return null;

  if (t.isNumericLiteral(node)) return node.value;

  if (t.isUnaryExpression(node) && node.operator === "-") {
    const inner = evalNumeric(node.argument, bindings);
    return inner !== null ? -inner : null;
  }

  if (t.isBinaryExpression(node)) {
    const left = evalNumeric(node.left as t.Expression, bindings);
    const right = evalNumeric(node.right as t.Expression, bindings);
    if (left === null || right === null) return null;
    switch (node.operator) {
      case "+": return left + right;
      case "-": return left - right;
      case "*": return left * right;
      case "/": return right !== 0 ? left / right : null;
      default: return null;
    }
  }

  if (t.isIdentifier(node)) {
    return bindings.get(node.name) ?? null;
  }

  return null;
};

const evalNumericArray = (
  node:
    | t.Expression
    | t.SpreadElement
    | t.JSXNamespacedName
    | t.ArgumentPlaceholder
    | null
    | undefined,
  bindings: Map<string, number>
): number[] | null => {
  if (!node || !t.isArrayExpression(node)) return null;
  const result: number[] = [];
  for (const el of node.elements) {
    if (!el || t.isSpreadElement(el)) return null;
    const val = evalNumeric(el, bindings);
    if (val === null) return null;
    result.push(val);
  }
  return result;
};

// ---------------------------------------------------------------------------
// JSX prop helper
// ---------------------------------------------------------------------------

const getJsxPropValue = (
  opening: t.JSXOpeningElement,
  propName: string
): t.Expression | null => {
  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr)) continue;
    if (!t.isJSXIdentifier(attr.name, { name: propName })) continue;
    if (!attr.value) return null;
    if (t.isJSXExpressionContainer(attr.value)) {
      const expr = attr.value.expression;
      return t.isJSXEmptyExpression(expr) ? null : (expr as t.Expression);
    }
    if (t.isStringLiteral(attr.value)) return attr.value;
    if (t.isNumericLiteral(attr.value)) return attr.value;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Source expression serializer
// ---------------------------------------------------------------------------

const sourceOf = (node: t.Node, sourceCode: string): string => {
  if (
    node.start !== null &&
    node.start !== undefined &&
    node.end !== null &&
    node.end !== undefined
  ) {
    return sourceCode.slice(node.start, node.end);
  }
  return "<dynamic>";
};

// ---------------------------------------------------------------------------
// Enclosing function name resolver
// ---------------------------------------------------------------------------

/**
 * Walks up the path to find the nearest enclosing function and returns its
 * inferred name (e.g. the variable name for arrow functions, or the function
 * declaration name).
 */
const enclosingFunctionName = (path: NodePath): string | null => {
  let p: NodePath | null = path.parentPath;
  while (p) {
    if (p.isFunctionDeclaration() && p.node.id) {
      return p.node.id.name;
    }
    if (p.isArrowFunctionExpression() || p.isFunctionExpression()) {
      // Walk up to the variable declarator to get the name
      const parent = p.parentPath;
      if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
        return parent.node.id.name;
      }
      if (parent?.isObjectProperty() && t.isIdentifier(parent.node.key)) {
        return parent.node.key.name;
      }
    }
    p = p.parentPath;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Property name inference
// ---------------------------------------------------------------------------

/**
 * Walks up from a call expression to infer which style/variable property it
 * drives. Prefers ObjectProperty key (e.g. opacity: interpolate(...)).
 * Falls back to VariableDeclarator id (e.g. const opacity = interpolate(...)).
 */
const inferProperty = (callPath: NodePath): string => {
  let p: NodePath | null = callPath.parentPath;
  while (p) {
    if (p.isObjectProperty()) {
      const k = p.node.key;
      if (t.isIdentifier(k)) return k.name;
      if (t.isStringLiteral(k)) return k.value;
    }
    if (p.isVariableDeclarator()) {
      const id = p.node.id;
      if (t.isIdentifier(id)) return id.name;
    }
    // Stop at function boundaries
    if (
      p.isArrowFunctionExpression() ||
      p.isFunctionExpression() ||
      p.isFunctionDeclaration()
    ) {
      break;
    }
    p = p.parentPath;
  }
  return "unknown";
};

// ---------------------------------------------------------------------------
// JSX element name helper
// ---------------------------------------------------------------------------

const getJsxElementName = (opening: t.JSXOpeningElement): string => {
  const nameNode = opening.name;
  if (t.isJSXIdentifier(nameNode)) return nameNode.name;
  if (t.isJSXMemberExpression(nameNode)) {
    const obj = t.isJSXIdentifier(nameNode.object)
      ? nameNode.object.name
      : "?";
    return `${obj}.${nameNode.property.name}`;
  }
  return "Unknown";
};

// ---------------------------------------------------------------------------
// Frame first-argument classifier
// ---------------------------------------------------------------------------

/**
 * Given the first argument of an interpolate() call and the enclosing
 * function's frame binding scope, determines whether to force dynamic type
 * and what frame offset to apply to the input range.
 *
 * Returns:
 *   { forceDynamic: true }  — offset is non-statically evaluable
 *   { forceDynamic: false, offset: number }  — apply this offset to input range
 */
const classifyFrameArg = (
  firstArg: t.Expression | t.SpreadElement | t.JSXNamespacedName | t.ArgumentPlaceholder,
  bindings: Map<string, number>,
  frameScope: FrameBindingScope | undefined
): { forceDynamic: true } | { forceDynamic: false; offset: number } => {
  if (!frameScope) return { forceDynamic: false, offset: 0 };

  if (t.isIdentifier(firstArg)) {
    if (firstArg.name === frameScope.frameVar) {
      return { forceDynamic: false, offset: 0 };
    }
    if (frameScope.derivedVars.has(firstArg.name)) {
      const offset = frameScope.derivedVars.get(firstArg.name) ?? null;
      if (offset === null) return { forceDynamic: true };
      return { forceDynamic: false, offset };
    }
  }

  if (t.isBinaryExpression(firstArg)) {
    const leftIsFrame =
      t.isIdentifier(firstArg.left) &&
      firstArg.left.name === frameScope.frameVar;
    if (leftIsFrame && (firstArg.operator === "-" || firstArg.operator === "+")) {
      const rightVal = evalNumeric(firstArg.right as t.Expression, bindings);
      if (rightVal !== null) {
        const offset = firstArg.operator === "-" ? -rightVal : rightVal;
        return { forceDynamic: false, offset };
      }
      return { forceDynamic: true };
    }
  }

  return { forceDynamic: false, offset: 0 };
};

// ---------------------------------------------------------------------------
// interpolate() extractor
// ---------------------------------------------------------------------------

const extractInterpolate = (
  callPath: NodePath<t.CallExpression>,
  bindings: Map<string, number>,
  sourceCode: string,
  frameScope: FrameBindingScope | undefined
): AnimationDescriptor => {
  const args = callPath.node.arguments;
  const firstArg = args[0];

  const classified = firstArg
    ? classifyFrameArg(firstArg, bindings, frameScope)
    : { forceDynamic: false as const, offset: 0 };

  if (classified.forceDynamic) {
    return {
      property: inferProperty(callPath),
      type: "dynamic",
      frameRange: [0, 0],
      valueRange: [0, 1],
      sourceExpression: sourceOf(callPath.node, sourceCode),
    };
  }

  const frameOffset = classified.offset;

  const inputRange = args[1]
    ? evalNumericArray(args[1] as t.Expression, bindings)
    : null;
  const outputRange = args[2]
    ? evalNumericArray(args[2] as t.Expression, bindings)
    : null;

  // Adjust input range by frame offset to produce absolute composition frame range
  const adjustedInputRange =
    inputRange && frameOffset !== 0
      ? inputRange.map((v) => v + frameOffset)
      : inputRange;

  const frameRange: [number, number] = adjustedInputRange
    ? [adjustedInputRange[0], adjustedInputRange[adjustedInputRange.length - 1]]
    : [0, 0];

  const valueRange: [number, number] = outputRange
    ? [outputRange[0], outputRange[outputRange.length - 1]]
    : [0, 1];

  let easing: AnimationDescriptor["easing"];
  const optionsArg = args[3];
  if (optionsArg && t.isObjectExpression(optionsArg as t.Expression)) {
    const easingObj: Record<string, string> = {};
    for (const prop of (optionsArg as t.ObjectExpression).properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;
      if (t.isStringLiteral(prop.value)) {
        easingObj[prop.key.name] = prop.value.value;
      }
    }
    if (Object.keys(easingObj).length > 0) {
      easing = {
        extrapolateLeft: easingObj["extrapolateLeft"],
        extrapolateRight: easingObj["extrapolateRight"],
      };
    }
  }

  const type: "interpolate" | "dynamic" =
    inputRange && outputRange ? "interpolate" : "dynamic";

  const descriptor: AnimationDescriptor = {
    property: inferProperty(callPath),
    type,
    frameRange,
    valueRange,
    sourceExpression: sourceOf(callPath.node, sourceCode),
  };
  if (easing) descriptor.easing = easing;
  return descriptor;
};

// ---------------------------------------------------------------------------
// spring() extractor
// ---------------------------------------------------------------------------

const extractSpring = (
  callPath: NodePath<t.CallExpression>,
  bindings: Map<string, number>,
  sourceCode: string
): AnimationDescriptor => {
  const args = callPath.node.arguments;
  const springConfig: AnimationDescriptor["springConfig"] = {};

  const configArg = args[0];
  if (configArg && t.isObjectExpression(configArg as t.Expression)) {
    for (const prop of (configArg as t.ObjectExpression).properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;
      if (prop.key.name === "config" && t.isObjectExpression(prop.value)) {
        for (const inner of prop.value.properties) {
          if (!t.isObjectProperty(inner) || !t.isIdentifier(inner.key))
            continue;
          const val = evalNumeric(inner.value as t.Expression, bindings);
          if (val !== null) {
            switch (inner.key.name) {
              case "damping":
                springConfig.damping = val;
                break;
              case "stiffness":
                springConfig.stiffness = val;
                break;
              case "mass":
                springConfig.mass = val;
                break;
            }
          }
          if (inner.key.name === "overshootClamping" && t.isBooleanLiteral(inner.value)) {
            springConfig.overshootClamping = inner.value.value;
          }
        }
      }
    }
  }

  const descriptor: AnimationDescriptor = {
    property: inferProperty(callPath),
    type: "spring",
    frameRange: [0, 0],
    valueRange: [0, 1],
    sourceExpression: sourceOf(callPath.node, sourceCode),
  };
  if (Object.keys(springConfig).length > 0) descriptor.springConfig = springConfig;
  return descriptor;
};

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

const DEFAULT_DURATION = 150;
const DEFAULT_FPS = 30;

export const parseTemporalMap = (sourceCode: string): TemporalMap => {
  const emptyMap: TemporalMap = {
    nodes: new Map(),
    compositionDuration: DEFAULT_DURATION,
    fps: DEFAULT_FPS,
  };

  if (!sourceCode.trim()) return emptyMap;

  let ast: t.File;
  try {
    ast = parse(sourceCode, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: true,
    });
  } catch {
    return emptyMap;
  }

  const state: ParserState = {
    nodes: new Map(),
    nodeToFunction: new Map(),
    pendingAnimations: [],
    sequenceStack: [],
    numericBindings: new Map(),
    sequenceCounter: 0,
    frameBindings: new Map(),
  };

  try {
    traverse(ast, {
      // ------------------------------------------------------------------
      // Numeric constant bindings + useCurrentFrame flow tracing
      // ------------------------------------------------------------------
      VariableDeclarator(path) {
        if (!t.isIdentifier(path.node.id) || !path.node.init) return;
        const varName = path.node.id.name;
        const init = path.node.init as t.Expression;

        // Detect: const frame = useCurrentFrame()
        if (
          t.isCallExpression(init) &&
          t.isIdentifier(init.callee) &&
          init.callee.name === "useCurrentFrame"
        ) {
          const fnName = enclosingFunctionName(path);
          const existing = state.frameBindings.get(fnName);
          if (existing) {
            existing.frameVar = varName;
          } else {
            state.frameBindings.set(fnName, {
              frameVar: varName,
              derivedVars: new Map(),
            });
          }
          return;
        }

        // Detect: const localFrame = frame - expr (derived binding)
        const fnName = enclosingFunctionName(path);
        const scope = state.frameBindings.get(fnName);
        if (scope && t.isBinaryExpression(init)) {
          const leftIsFrame =
            t.isIdentifier(init.left) && init.left.name === scope.frameVar;
          if (
            leftIsFrame &&
            (init.operator === "-" || init.operator === "+")
          ) {
            const rightVal = evalNumeric(
              init.right as t.Expression,
              state.numericBindings
            );
            const offset =
              rightVal !== null
                ? init.operator === "-"
                  ? -rightVal
                  : rightVal
                : null;
            scope.derivedVars.set(varName, offset);
          }
        }

        // Numeric constant binding (existing behavior)
        const val = evalNumeric(init, state.numericBindings);
        if (val !== null) {
          state.numericBindings.set(varName, val);
        }
      },

      // ------------------------------------------------------------------
      // Sequence boundary tracking
      // ------------------------------------------------------------------
      JSXElement: {
        enter(path) {
          const name = getJsxElementName(path.node.openingElement);
          if (name !== "Sequence") return;

          const fromExpr = getJsxPropValue(path.node.openingElement, "from");
          const durExpr = getJsxPropValue(
            path.node.openingElement,
            "durationInFrames"
          );

          const localFrom = fromExpr
            ? (evalNumeric(fromExpr, state.numericBindings) ?? 0)
            : 0;

          const parentAbsoluteFrom =
            state.sequenceStack.length > 0
              ? state.sequenceStack[state.sequenceStack.length - 1].absoluteFrom
              : 0;

          const absoluteFrom = parentAbsoluteFrom + localFrom;
          const dur = durExpr
            ? (evalNumeric(durExpr, state.numericBindings) ?? 0)
            : 0;

          state.sequenceCounter += 1;
          const id = `Sequence:${
            path.node.openingElement.loc?.start.line ?? state.sequenceCounter
          }`;

          // Add Sequence as a TemporalNode so the timeline panel can display it.
          // sequencePath is the parent stack (before pushing this Sequence).
          const parentSeqPath = state.sequenceStack.map((s) => s.id);
          const line = path.node.openingElement.loc?.start.line ?? 0;
          const endLine = path.node.openingElement.loc?.end.line ?? line;
          if (!state.nodes.has(id)) {
            state.nodes.set(id, {
              id,
              sourceRange: [line, endLine],
              componentName: "Sequence",
              activeFrameRange: dur > 0 ? [absoluteFrom, absoluteFrom + dur] : null,
              animations: [],
              sequencePath: parentSeqPath,
            });
            state.nodeToFunction.set(id, enclosingFunctionName(path));
          }

          state.sequenceStack.push({ id, from: localFrom, durationInFrames: dur, absoluteFrom });
        },
        exit(path) {
          const name = getJsxElementName(path.node.openingElement);
          if (name === "Sequence") state.sequenceStack.pop();
        },
      },

      // ------------------------------------------------------------------
      // JSX element → TemporalNode
      // ------------------------------------------------------------------
      JSXOpeningElement(path) {
        const name = getJsxElementName(path.node);
        if (!name || name === "Sequence") return;

        const line = path.node.loc?.start.line ?? 0;
        const endLine = path.node.loc?.end.line ?? line;
        const id = `${name}:${line}`;

        const activeFrameRange: [number, number] | null =
          state.sequenceStack.length > 0
            ? [
                state.sequenceStack[state.sequenceStack.length - 1]
                  .absoluteFrom,
                state.sequenceStack[state.sequenceStack.length - 1]
                  .absoluteFrom +
                  state.sequenceStack[state.sequenceStack.length - 1]
                    .durationInFrames,
              ]
            : null;

        const seqPath = state.sequenceStack.map((s) => s.id);

        if (!state.nodes.has(id)) {
          state.nodes.set(id, {
            id,
            sourceRange: [line, endLine],
            componentName: name,
            activeFrameRange,
            animations: [],
            sequencePath: seqPath,
          });
          // Record the enclosing function so we can match animations later
          state.nodeToFunction.set(id, enclosingFunctionName(path));
        }
      },

      // ------------------------------------------------------------------
      // Animation call expressions — collected as pending, matched later
      // ------------------------------------------------------------------
      CallExpression(path) {
        const callee = path.node.callee;
        const callLine = path.node.loc?.start.line ?? 0;
        const fnName = enclosingFunctionName(path);
        const frameScope = state.frameBindings.get(fnName);

        if (t.isIdentifier(callee, { name: "interpolate" })) {
          const descriptor = extractInterpolate(
            path as NodePath<t.CallExpression>,
            state.numericBindings,
            sourceCode,
            frameScope
          );
          state.pendingAnimations.push({
            descriptor,
            enclosingFnName: fnName,
            callLine,
          });
          return;
        }

        if (t.isIdentifier(callee, { name: "spring" })) {
          const descriptor = extractSpring(
            path as NodePath<t.CallExpression>,
            state.numericBindings,
            sourceCode
          );
          state.pendingAnimations.push({
            descriptor,
            enclosingFnName: fnName,
            callLine,
          });
        }
      },
    });
  } catch {
    // Partial results are still useful
  }

  // --------------------------------------------------------------------------
  // Post-process: match pending animations to nodes by enclosing function name
  // --------------------------------------------------------------------------
  for (const pending of state.pendingAnimations) {
    // First, try to find a node whose enclosing function matches
    const candidates: TemporalNode[] = [];

    for (const [id, node] of state.nodes) {
      const nodeFn = state.nodeToFunction.get(id);
      if (
        pending.enclosingFnName !== null &&
        nodeFn === pending.enclosingFnName
      ) {
        candidates.push(node);
      }
    }

    if (candidates.length > 0) {
      // Attach to the first (outermost) JSX element in the same function —
      // use the node with the smallest source line as the representative.
      const target = candidates.reduce((a, b) =>
        a.sourceRange[0] < b.sourceRange[0] ? a : b
      );
      target.animations.push(pending.descriptor);
    } else {
      // Fallback: attach to the last node registered before this call line.
      // This handles animations in JSX attribute expressions.
      let fallback: TemporalNode | null = null;
      for (const node of state.nodes.values()) {
        if (node.sourceRange[0] <= pending.callLine) {
          fallback = node;
        }
      }
      if (fallback) fallback.animations.push(pending.descriptor);
    }
  }

  return {
    nodes: state.nodes,
    compositionDuration: DEFAULT_DURATION,
    fps: DEFAULT_FPS,
  };
};
