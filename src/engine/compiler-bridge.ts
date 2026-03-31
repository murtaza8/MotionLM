/**
 * compiler-bridge.ts
 *
 * Thin async wrapper around the Babel compilation worker.
 *
 * Split of work:
 *   Worker  — Babel.transform() for all VFS files (slow, ~50ms, off main thread)
 *   Bridge  — new Function() execution to obtain React components (fast, <1ms, main thread)
 *
 * Fallback: if Workers are unavailable (SSR, older browser), compileAsync falls
 * through to synchronous compileWithVFS().
 */

import {
  compileWithVFS,
  extractTopLevelNames,
  resolveRootComponent,
  API_PARAM_NAMES,
  API_PARAM_VALUES,
  REGISTRY_PARAM,
  humanizeRuntimeError,
} from "@/engine/compiler";

import type { CompileResult } from "@/engine/compiler";

// ---------------------------------------------------------------------------
// Worker message types (mirror of compiler.worker.ts)
// ---------------------------------------------------------------------------

interface CompileRequest {
  type: "compile";
  requestId: string;
  entryPath: string;
  files: Record<string, string>;
}

type WorkerResult =
  | {
      type: "result";
      requestId: string;
      ok: true;
      transformedSources: Record<string, string>;
      compilationOrder: string[];
    }
  | {
      type: "result";
      requestId: string;
      ok: false;
      error: string;
    };

// ---------------------------------------------------------------------------
// Pending request map
// ---------------------------------------------------------------------------

type PendingEntry = {
  resolve: (result: { transformedSources: Record<string, string>; compilationOrder: string[] }) => void;
  reject: (error: Error) => void;
};

const pending = new Map<string, PendingEntry>();
let workerInstance: Worker | null = null;
let workerUnavailable = false;

function getWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (workerInstance) return workerInstance;

  try {
    workerInstance = new Worker(
      new URL("./compiler.worker.ts", import.meta.url),
      { type: "module" }
    );

    workerInstance.onmessage = (event: MessageEvent<WorkerResult>) => {
      const msg = event.data;
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      pending.delete(msg.requestId);

      if (msg.ok) {
        entry.resolve({
          transformedSources: msg.transformedSources,
          compilationOrder: msg.compilationOrder,
        });
      } else {
        entry.reject(new Error(msg.error));
      }
    };

    workerInstance.onerror = () => {
      // Reject all pending and disable worker for this session
      for (const entry of pending.values()) {
        entry.reject(new Error("Compiler worker crashed"));
      }
      pending.clear();
      workerInstance = null;
      workerUnavailable = true;
    };

    return workerInstance;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Execute transformed sources on the main thread via new Function()
// ---------------------------------------------------------------------------

const MODULE_SCOPE_PARAM = "__moduleScope__";

function executeTransformed(
  entryPath: string,
  transformedSources: Record<string, string>,
  compilationOrder: string[]
): CompileResult {
  // Registry: filePath → exported values (for VFS inter-file imports)
  const vfsRegistry: Record<string, Record<string, unknown>> = {};

  for (const filePath of compilationOrder) {
    const transformedCode = transformedSources[filePath];
    if (transformedCode === undefined) continue;

    const names = extractTopLevelNames(transformedCode);
    const assignmentLines = names
      .map((name) => `try { ${MODULE_SCOPE_PARAM}["${name}"] = ${name}; } catch(_) {}`)
      .join("\n");

    const fnBody = `${transformedCode}\n${assignmentLines}`;
    const moduleScope: Record<string, unknown> = {};

    try {
      const fn = new Function(
        REGISTRY_PARAM,
        MODULE_SCOPE_PARAM,
        ...API_PARAM_NAMES,
        fnBody
      );
      fn(vfsRegistry, moduleScope, ...API_PARAM_VALUES);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: humanizeRuntimeError(message) };
    }

    vfsRegistry[filePath] = moduleScope;
  }

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

  return { ok: true, Component: component };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Worker must respond within this window or the bridge falls back to sync. */
const WORKER_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compiles VFS files asynchronously using the background Web Worker for the
 * Babel transform step, then executes new Function() on the main thread to
 * obtain the React component.
 *
 * Falls back to synchronous compileWithVFS() if the Worker is unavailable,
 * crashes, or does not respond within WORKER_TIMEOUT_MS (10 seconds).
 */
export const compileAsync = async (
  entryPath: string,
  files: Map<string, string>
): Promise<CompileResult> => {
  const worker = getWorker();

  if (!worker) {
    return compileWithVFS(entryPath, files);
  }

  const filesRecord: Record<string, string> = {};
  files.forEach((code, path) => {
    filesRecord[path] = code;
  });

  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const workerResult = await new Promise<{
      transformedSources: Record<string, string>;
      compilationOrder: string[];
    }>((resolve, reject) => {
      // Timeout: if the worker hangs, reject and fall back to sync so the
      // agent loop never blocks indefinitely waiting for compilation.
      const timeoutId = setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          reject(new Error("Compiler worker timed out after 10s"));
        }
      }, WORKER_TIMEOUT_MS);

      pending.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          reject(err);
        },
      });

      const req: CompileRequest = {
        type: "compile",
        requestId,
        entryPath,
        files: filesRecord,
      };
      worker.postMessage(req);
    });

    return executeTransformed(
      entryPath,
      workerResult.transformedSources,
      workerResult.compilationOrder
    );
  } catch (err: unknown) {
    // Worker error or timeout — fall back to synchronous path.
    // workerUnavailable is already set by onerror if the worker crashed.
    return compileWithVFS(entryPath, files);
  }
};
