import React from "react";
import * as Babel from "@babel/standalone";
import { parse } from "@babel/parser";
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
import {
  makeVfsImportTransformerPlugin,
  resolveVFSImport,
} from "./babel-plugins/vfs-import-transformer";

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
// compileWithVFS — multi-file entry point
// ---------------------------------------------------------------------------

/**
 * Compiles an entire VFS starting from `entryPath`.
 *
 * Pipeline:
 * 1. Build an import dependency graph by parsing each reachable file.
 * 2. Topological sort to get a dependency-first compile order.
 * 3. Compile each file in order; each compiled file's exports are stored in
 *    a `vfsRegistry` that is injected into subsequent compilations via
 *    `__vfsRegistry__`.
 * 4. Extract the root React component from the entry file's exports.
 *
 * Falls through to the single-file path when only one file is present.
 */
export const compileWithVFS = (
  entryPath: string,
  files: Map<string, string>
): CompileResult => {
  if (files.size <= 1) {
    const source = files.get(entryPath) ?? "";
    return compileComposition(source);
  }

  // --- 1. Build dependency graph ---
  const depGraphResult = buildDepGraph(entryPath, files);
  if ("error" in depGraphResult) {
    return { ok: false, error: depGraphResult.error };
  }
  const depGraph = depGraphResult.graph;

  // --- 2. Topological sort ---
  const sortResult = topoSort(entryPath, depGraph);
  if ("error" in sortResult) {
    return { ok: false, error: sortResult.error };
  }

  // --- 3. Compile files in dependency-first order ---
  const vfsPaths = new Set(files.keys());
  // Registry: path → exported names → values
  const vfsRegistry: Record<string, Record<string, unknown>> = {};

  for (const filePath of sortResult.order) {
    const source = files.get(filePath);
    if (source === undefined) continue;

    const fileResult = compileSingleFile(
      source,
      filePath,
      vfsPaths,
      vfsRegistry
    );
    if (!fileResult.ok) return { ok: false, error: fileResult.error };

    vfsRegistry[filePath] = fileResult.exports;
  }

  // --- 4. Extract root component from entry file ---
  const entryExports = vfsRegistry[entryPath];
  if (!entryExports) {
    return { ok: false, error: "Entry file produced no exports." };
  }

  const component = resolveRootComponent(entryExports);
  if (!component) {
    return {
      ok: false,
      error:
        "No React component found in entry file. Make sure the entry exports a function component.",
    };
  }

  return { ok: true, Component: component as React.ComponentType };
};

// ---------------------------------------------------------------------------
// compileSingleFile — compiles one file with VFS registry injected
// ---------------------------------------------------------------------------

const REGISTRY_PARAM = "__vfsRegistry__";

function compileSingleFile(
  source: string,
  filePath: string,
  vfsPaths: Set<string>,
  vfsRegistry: Record<string, Record<string, unknown>>
): { ok: true; exports: Record<string, unknown> } | { ok: false; error: string } {
  let transformedCode: string;
  try {
    const result = Babel.transform(source, {
      presets: ["react", "typescript"],
      plugins: [
        makeVfsImportTransformerPlugin(vfsPaths, filePath),
        importStripperPlugin,
        sourceMapPlugin,
      ],
      filename: filePath.replace(/^\/+/, "") || "file.tsx",
    });

    if (!result.code) {
      return { ok: false, error: `Babel transform of ${filePath} produced no output.` };
    }
    transformedCode = result.code;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: humanizeTransformError(message) };
  }

  const moduleScope: Record<string, unknown> = {};
  const scopeParam = "__moduleScope__";

  const componentNames = extractTopLevelNames(transformedCode);
  const assignmentLines = componentNames
    .map((name) => `try { ${scopeParam}["${name}"] = ${name}; } catch(_) {}`)
    .join("\n");

  const fnBody = `${transformedCode}\n${assignmentLines}`;

  try {
    const fn = new Function(REGISTRY_PARAM, scopeParam, ...API_PARAM_NAMES, fnBody);
    fn(vfsRegistry, moduleScope, ...API_PARAM_VALUES);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: humanizeRuntimeError(message) };
  }

  return { ok: true, exports: moduleScope };
}

// ---------------------------------------------------------------------------
// Dependency graph — parse imports to find VFS inter-file dependencies
// ---------------------------------------------------------------------------

type DepGraph = Map<string, string[]>;

function buildDepGraph(
  entryPath: string,
  files: Map<string, string>
): { graph: DepGraph } | { error: string } {
  const vfsPaths = new Set(files.keys());
  const graph: DepGraph = new Map();

  // BFS from entry to discover all reachable VFS files
  const queue: string[] = [entryPath];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const filePath = queue.shift()!;
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    const source = files.get(filePath);
    if (source === undefined) {
      graph.set(filePath, []);
      continue;
    }

    const deps = extractVFSImports(source, filePath, vfsPaths);
    graph.set(filePath, deps);

    for (const dep of deps) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }

  return { graph };
}

/** Uses @babel/parser to extract relative imports that resolve to VFS paths. */
function extractVFSImports(
  source: string,
  filePath: string,
  vfsPaths: Set<string>
): string[] {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch {
    return [];
  }

  const imports: string[] = [];
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    const importSource = node.source.value;
    const resolved = resolveVFSImport(importSource, filePath, vfsPaths);
    if (resolved !== null) imports.push(resolved);
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Topological sort with cycle detection
// ---------------------------------------------------------------------------

function topoSort(
  entryPath: string,
  graph: DepGraph
): { order: string[] } | { error: string } {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  function dfs(node: string): string[] | null {
    if (visiting.has(node)) return [node];
    if (visited.has(node)) return null;

    visiting.add(node);

    for (const dep of graph.get(node) ?? []) {
      const cycle = dfs(dep);
      if (cycle !== null) {
        // Append current node to build the cycle path (will be reversed after)
        if (cycle[cycle.length - 1] !== node) cycle.push(node);
        return cycle;
      }
    }

    visiting.delete(node);
    visited.add(node);
    // Post-order push ensures dependencies precede dependents
    order.push(node);
    return null;
  }

  // Visit entry first, then any other reachable nodes
  const cycle = dfs(entryPath);
  if (cycle !== null) {
    const path = [...cycle].reverse().join(" → ");
    return { error: `Circular dependency detected: ${path}` };
  }

  // Visit any remaining graph nodes (disconnected files — compile them too)
  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      const c = dfs(node);
      if (c !== null) {
        const path = [...c].reverse().join(" → ");
        return { error: `Circular dependency detected: ${path}` };
      }
    }
  }

  return { order };
}

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
