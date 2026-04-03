/**
 * Babel compilation worker.
 *
 * Handles the expensive Babel.transform step off the main thread.
 * Returns transformed source strings — NOT React components. Functions cannot
 * be transferred via postMessage; the bridge runs new Function() on the main
 * thread from the returned strings.
 *
 * Message in:  CompileRequest
 * Message out: CompileResponse
 */

import * as Babel from "@babel/standalone";
import { parse } from "@babel/parser";
import { importStripperPlugin } from "./babel-plugins/import-stripper";
import { sourceMapPlugin } from "./babel-plugins/source-map";
import {
  makeVfsImportTransformerPlugin,
  resolveVFSImport,
} from "./babel-plugins/vfs-import-transformer";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface CompileRequest {
  type: "compile";
  requestId: string;
  entryPath: string;
  /** filePath → raw source code (serialisable plain strings) */
  files: Record<string, string>;
}

type CompileResponse =
  | {
      type: "result";
      requestId: string;
      ok: true;
      /** filePath → Babel-transformed JS (no JSX, no TS, imports stripped) */
      transformedSources: Record<string, string>;
      /** Dependency-first compilation order */
      compilationOrder: string[];
    }
  | {
      type: "result";
      requestId: string;
      ok: false;
      error: string;
    };

// ---------------------------------------------------------------------------
// Dep graph helpers (mirrors compiler.ts — kept separate to avoid useStore dep)
// ---------------------------------------------------------------------------

type DepGraph = Map<string, string[]>;

function buildDepGraph(
  entryPath: string,
  files: Map<string, string>
): { graph: DepGraph } | { error: string } {
  const vfsPaths = new Set(files.keys());
  const graph: DepGraph = new Map();
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
    const resolved = resolveVFSImport(node.source.value, filePath, vfsPaths);
    if (resolved !== null) imports.push(resolved);
  }
  return imports;
}

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
        if (cycle[cycle.length - 1] !== node) cycle.push(node);
        return cycle;
      }
    }
    visiting.delete(node);
    visited.add(node);
    order.push(node);
    return null;
  }

  const cycle = dfs(entryPath);
  if (cycle !== null) {
    return { error: `Circular dependency detected: ${[...cycle].reverse().join(" → ")}` };
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      const c = dfs(node);
      if (c !== null) {
        return { error: `Circular dependency detected: ${[...c].reverse().join(" → ")}` };
      }
    }
  }

  return { order };
}

// ---------------------------------------------------------------------------
// Babel transform helpers
// ---------------------------------------------------------------------------

function humanizeTransformError(message: string): string {
  if (message.includes("Unexpected token")) {
    return `Syntax error: ${message.split("\n")[0]}`;
  }
  if (message.includes("is not defined")) {
    return `Reference error during transform: ${message.split("\n")[0]}`;
  }
  return `Compilation error: ${message.split("\n")[0]}`;
}

function transformFile(
  source: string,
  filePath: string,
  vfsPaths: Set<string>
): { ok: true; code: string } | { ok: false; error: string } {
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
    return { ok: true, code: result.code };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: humanizeTransformError(message) };
  }
}

// ---------------------------------------------------------------------------
// Main compile handler
// ---------------------------------------------------------------------------

function handleCompile(req: CompileRequest): CompileResponse {
  const { requestId, entryPath, files: filesRecord } = req;

  const files = new Map(Object.entries(filesRecord));
  const vfsPaths = new Set(files.keys());

  // Single-file fast path
  if (files.size <= 1) {
    const source = files.get(entryPath) ?? "";
    const result = transformFile(source, entryPath, vfsPaths);
    if (!result.ok) {
      return { type: "result", requestId, ok: false, error: result.error };
    }
    return {
      type: "result",
      requestId,
      ok: true,
      transformedSources: { [entryPath]: result.code },
      compilationOrder: [entryPath],
    };
  }

  // Multi-file: dep graph → topo sort → transform each file
  const graphResult = buildDepGraph(entryPath, files);
  if ("error" in graphResult) {
    return { type: "result", requestId, ok: false, error: graphResult.error };
  }

  const sortResult = topoSort(entryPath, graphResult.graph);
  if ("error" in sortResult) {
    return { type: "result", requestId, ok: false, error: sortResult.error };
  }

  const transformedSources: Record<string, string> = {};

  for (const filePath of sortResult.order) {
    const source = files.get(filePath);
    if (source === undefined) continue;

    const result = transformFile(source, filePath, vfsPaths);
    if (!result.ok) {
      return { type: "result", requestId, ok: false, error: result.error };
    }
    transformedSources[filePath] = result.code;
  }

  return {
    type: "result",
    requestId,
    ok: true,
    transformedSources,
    compilationOrder: sortResult.order,
  };
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<CompileRequest>) => {
  const response = handleCompile(event.data);
  self.postMessage(response);
};
