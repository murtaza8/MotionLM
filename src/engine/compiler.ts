import React from "react";
import * as Babel from "@babel/standalone";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Sequence,
  Easing,
  Img,
  staticFile,
} from "remotion";
import { useEffect, useRef } from "react";
import { useStore } from "@/store";
import { importStripperPlugin } from "./babel-plugins/import-stripper";
import { sourceMapPlugin } from "./babel-plugins/source-map";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompileResult =
  | { ok: true; Component: React.ComponentType }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Remotion API surface injected into every compiled composition
// ---------------------------------------------------------------------------

const REMOTION_APIS = {
  React,
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Sequence,
  Easing,
  Img,
  staticFile,
} as const;

const API_PARAM_NAMES = Object.keys(REMOTION_APIS);
const API_PARAM_VALUES = Object.values(REMOTION_APIS);

// ---------------------------------------------------------------------------
// compileComposition
// ---------------------------------------------------------------------------

/**
 * Transforms and executes a Remotion composition source string, returning the
 * last declared React component found in the module.
 *
 * Pipeline:
 * 1. Babel.transform() — strips imports/exports, transpiles JSX + TypeScript
 * 2. new Function() — executes the transformed code with injected Remotion APIs
 * 3. Extracts the last function/const component from the module scope
 */
export const compileComposition = (sourceCode: string): CompileResult => {
  // Step 1: Babel transform
  let transformedCode: string;
  try {
    const result = Babel.transform(sourceCode, {
      presets: ["react", "typescript"],
      plugins: [importStripperPlugin, sourceMapPlugin],
      filename: "composition.tsx",
    });

    if (!result.code) {
      return { ok: false, error: "Babel transform produced no output." };
    }

    transformedCode = result.code;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: humanizeTransformError(message) };
  }

  // Step 2: Execute via new Function() with injected APIs
  // The module scope object collects all named declarations
  const moduleScope: Record<string, unknown> = {};
  const scopeParam = "__moduleScope__";

  // Wrap transformed code so every top-level const/function declaration is
  // mirrored onto moduleScope.  We do this by appending assignment lines
  // after the transformed output using a simple extraction pass.
  const componentNames = extractTopLevelNames(transformedCode);
  const assignmentLines = componentNames
    .map((name) => `try { ${scopeParam}["${name}"] = ${name}; } catch(_) {}`)
    .join("\n");

  const fnBody = `${transformedCode}\n${assignmentLines}`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(scopeParam, ...API_PARAM_NAMES, fnBody);
    fn(moduleScope, ...API_PARAM_VALUES);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: humanizeRuntimeError(message) };
  }

  // Step 3: Find the root component — last exported React-like function/class
  const component = resolveRootComponent(moduleScope);
  if (!component) {
    return {
      ok: false,
      error:
        "No React component found. Make sure the composition exports a function component.",
    };
  }

  return { ok: true, Component: component as React.ComponentType };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts top-level `const`, `function`, and `class` declaration names from
 * already-transpiled (non-JSX) JS code using a lightweight regex pass.
 * This is intentionally simple — it only needs to capture component names for
 * the scope mirror pattern above, not perform full AST analysis.
 */
const extractTopLevelNames = (code: string): string[] => {
  const names: string[] = [];
  // Match: const Foo = ..., function Foo, class Foo
  const pattern =
    /^(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    names.push(match[1]);
  }
  return names;
};

/**
 * Picks the root component from the module scope. Preference order:
 * 1. Last value that is a function with a name starting with an uppercase
 *    letter (React component convention)
 * 2. Any function value
 */
const resolveRootComponent = (
  scope: Record<string, unknown>
): React.ComponentType | null => {
  const entries = Object.entries(scope);
  let lastComponent: React.ComponentType | null = null;

  for (const [, value] of entries) {
    if (typeof value === "function") {
      const name = (value as { name?: string }).name ?? "";
      if (/^[A-Z]/.test(name)) {
        lastComponent = value as React.ComponentType;
      }
    }
  }

  if (lastComponent) return lastComponent;

  // Fallback: any function
  for (const [, value] of entries) {
    if (typeof value === "function") {
      return value as React.ComponentType;
    }
  }

  return null;
};

const humanizeTransformError = (message: string): string => {
  if (message.includes("Unexpected token")) {
    return `Syntax error: ${message.split("\n")[0]}`;
  }
  if (message.includes("is not defined")) {
    return `Reference error during transform: ${message.split("\n")[0]}`;
  }
  return `Compilation error: ${message.split("\n")[0]}`;
};

const humanizeRuntimeError = (message: string): string => {
  if (message.includes("is not defined")) {
    return `Undefined reference: ${message.split("\n")[0]}`;
  }
  return `Runtime error: ${message.split("\n")[0]}`;
};

// ---------------------------------------------------------------------------
// useCompilation hook
// ---------------------------------------------------------------------------

/**
 * Watches a VFS file's draftCode / activeCode and runs the compiler pipeline.
 * On success: updates compilationStatus to 'success' (caller promotes draft).
 * On failure: updates compilationStatus to 'error' with the error message.
 *
 * Returns the latest successful CompileResult so the caller can render the
 * compiled component immediately.
 */
export const useCompilation = (
  filePath: string
): { result: CompileResult | null } => {
  const file = useStore((s) => s.files.get(filePath));
  const setCompilationStatus = useStore((s) => s.setCompilationStatus);
  const promoteDraft = useStore((s) => s.promoteDraft);
  const discardDraft = useStore((s) => s.discardDraft);

  const resultRef = useRef<CompileResult | null>(null);

  const sourceToCompile = file?.draftCode ?? file?.activeCode ?? null;
  const prevSourceRef = useRef<string | null>(null);

  useEffect(() => {
    if (sourceToCompile === null) return;
    if (sourceToCompile === prevSourceRef.current) return;
    prevSourceRef.current = sourceToCompile;

    const isDraft = file?.draftCode !== null && file?.draftCode !== undefined;

    setCompilationStatus(filePath, "compiling");

    const result = compileComposition(sourceToCompile);
    resultRef.current = result;

    if (result.ok) {
      setCompilationStatus(filePath, "success");
      if (isDraft) {
        promoteDraft(filePath);
      }
    } else {
      setCompilationStatus(filePath, "error", result.error);
      if (isDraft) {
        discardDraft(filePath);
      }
    }
  }, [
    sourceToCompile,
    filePath,
    file?.draftCode,
    setCompilationStatus,
    promoteDraft,
    discardDraft,
  ]);

  return { result: resultRef.current };
};
