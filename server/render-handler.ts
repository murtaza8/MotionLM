import path from "path";
import fs from "fs/promises";
import os from "os";
import { EventEmitter } from "events";

import { bundle } from "@remotion/bundler";
import { getCompositions, renderMedia, renderStill } from "@remotion/renderer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RenderStatus = "bundling" | "rendering" | "done" | "error";

export interface RenderJob {
  id: string;
  status: RenderStatus;
  /** 0–100 */
  progress: number;
  outputPath: string | null;
  outputExt: string;
  error: string | null;
  createdAt: number;
  emitter: EventEmitter;
  tmpDir: string | null;
}

export interface RenderParams {
  vfs: Record<string, string>;
  compositionId: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  codec: "h264" | "h265" | "vp8" | "vp9" | "prores" | "gif";
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

const jobs = new Map<string, RenderJob>();

const CLEANUP_DELAY_MS = 60 * 60 * 1000; // 1 hour

export function getRenderJob(id: string): RenderJob | undefined {
  return jobs.get(id);
}

function scheduleCleanup(jobId: string): void {
  setTimeout(async () => {
    const job = jobs.get(jobId);
    if (!job) return;
    if (job.tmpDir) {
      await fs.rm(job.tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
    jobs.delete(jobId);
  }, CLEANUP_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the first exported PascalCase identifier from a TSX source string.
 * Handles: `export const Foo`, `export function Foo`, `export class Foo`.
 */
function extractComponentName(code: string): string | null {
  const match = code.match(/export\s+(?:const|function|class)\s+([A-Z][a-zA-Z0-9]*)/);
  return match ? (match[1] ?? null) : null;
}

function outputExtForCodec(codec: RenderParams["codec"]): string {
  return codec === "gif" ? "gif" : "mp4";
}

// ---------------------------------------------------------------------------
// handleRender
// ---------------------------------------------------------------------------

export async function handleRender(
  params: RenderParams
): Promise<{ ok: true; renderId: string } | { ok: false; error: string }> {
  const renderId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const emitter = new EventEmitter();
  emitter.setMaxListeners(32);

  const job: RenderJob = {
    id: renderId,
    status: "bundling",
    progress: 0,
    outputPath: null,
    outputExt: outputExtForCodec(params.codec),
    error: null,
    createdAt: Date.now(),
    emitter,
    tmpDir: null,
  };
  jobs.set(renderId, job);

  // Kick off async — do not await here so the HTTP response returns immediately
  void runRender(job, params);

  scheduleCleanup(renderId);
  return { ok: true, renderId };
}

// ---------------------------------------------------------------------------
// handleRenderStill
// ---------------------------------------------------------------------------

export interface RenderStillParams {
  files: Record<string, string>;
  entryPath?: string;
  compositionId: string;
  frame: number;
  width: number;
  height: number;
}

/**
 * Synchronously renders a single PNG frame from a VFS snapshot.
 * Bundles, finds the composition, calls renderStill(), and returns base64.
 * Cleans up temp files on completion or error.
 */
export async function handleRenderStill(
  params: RenderStillParams
): Promise<{ ok: true; data: string } | { ok: false; error: string }> {
  const { files, entryPath: providedEntryPath, compositionId, frame, width, height } = params;
  let tmpDir: string | null = null;

  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "motionlm-still-"));

    // --- Write VFS files to disk ---
    for (const [vfsPath, code] of Object.entries(files)) {
      const relative = vfsPath.replace(/^\/+/, "");
      const fullPath = path.join(tmpDir, relative);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, code, "utf-8");
    }

    // --- Determine entry point ---
    // Use the explicitly provided entryPath when available (passed by capture_frame
    // / capture_sequence from store.activeFilePath). Fall back to /main.tsx →
    // main.tsx → first file so the handler still works without it.
    const mainVfsKey =
      (providedEntryPath && providedEntryPath in files) ? providedEntryPath :
      "/main.tsx" in files ? "/main.tsx" :
      "main.tsx" in files ? "main.tsx" :
      Object.keys(files)[0] ?? "/main.tsx";

    const mainCode = files[mainVfsKey] ?? "";
    // Relative disk path, e.g. "billiard-shot.tsx" (strip leading slash)
    const mainRelative = mainVfsKey.replace(/^\/+/, "");
    // Import-safe path without extension, e.g. "./billiard-shot"
    const mainImportPath = "./" + mainRelative.replace(/\.(tsx?|jsx?)$/, "");

    let entryPoint: string;

    if (mainCode.includes("registerRoot")) {
      entryPoint = path.join(tmpDir, mainRelative);
    } else {
      const componentName = extractComponentName(mainCode) ?? "Main";
      const wrapper = [
        `import { registerRoot, Composition } from 'remotion';`,
        `import { ${componentName} } from '${mainImportPath}';`,
        ``,
        `const RemotionRoot = () => (`,
        `  <Composition`,
        `    id="${compositionId}"`,
        `    component={${componentName}}`,
        `    durationInFrames={300}`,
        `    fps={30}`,
        `    width={${width}}`,
        `    height={${height}}`,
        `    defaultProps={{}}`,
        `  />`,
        `);`,
        ``,
        `registerRoot(RemotionRoot);`,
      ].join("\n");
      entryPoint = path.join(tmpDir, "entry.tsx");
      await fs.writeFile(entryPoint, wrapper, "utf-8");
    }

    // --- Bundle ---
    const serveUrl = await bundle({
      entryPoint,
      webpackOverride: (config) => {
        const existing = config.resolve?.modules ?? ["node_modules"];
        return {
          ...config,
          resolve: {
            ...config.resolve,
            modules: [
              ...existing,
              path.join(process.cwd(), "node_modules"),
            ],
          },
        };
      },
    });

    // --- Find composition ---
    const compositions = await getCompositions(serveUrl);
    const composition = compositions.find((c) => c.id === compositionId);

    if (!composition) {
      const available = compositions.map((c) => c.id).join(", ");
      throw new Error(
        `Composition "${compositionId}" not found. Available: ${available || "none"}`
      );
    }

    // Override resolution for the still render
    const compositionForStill = { ...composition, width, height };

    // --- Render still ---
    const outputPath = path.join(tmpDir, "still.png");
    await renderStill({
      composition: compositionForStill,
      serveUrl,
      output: outputPath,
      frame,
      imageFormat: "png",
    });

    // --- Read and base64-encode ---
    const buffer = await fs.readFile(outputPath);
    const data = buffer.toString("base64");

    return { ok: true, data };
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Unknown error during still render";
    return { ok: false, error };
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function runRender(job: RenderJob, params: RenderParams): Promise<void> {
  let tmpDir: string | null = null;

  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "motionlm-render-"));
    job.tmpDir = tmpDir;

    // --- Write VFS files to disk ---
    for (const [vfsPath, code] of Object.entries(params.vfs)) {
      // vfsPath is like "/main.tsx" — strip leading slash
      const relative = vfsPath.replace(/^\/+/, "");
      const fullPath = path.join(tmpDir, relative);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, code, "utf-8");
    }

    // --- Determine entry point ---
    const mainCode =
      params.vfs["/main.tsx"] ??
      params.vfs["main.tsx"] ??
      Object.values(params.vfs)[0] ??
      "";

    let entryPoint: string;

    if (mainCode.includes("registerRoot")) {
      // Generated code already has registerRoot — use it directly
      entryPoint = path.join(tmpDir, "main.tsx");
    } else {
      // Build a wrapper entry that registers the composition
      const componentName = extractComponentName(mainCode) ?? "Main";
      const wrapper = [
        `import { registerRoot, Composition } from 'remotion';`,
        `import { ${componentName} } from './main';`,
        ``,
        `const RemotionRoot = () => (`,
        `  <Composition`,
        `    id="${params.compositionId}"`,
        `    component={${componentName}}`,
        `    durationInFrames={${params.durationInFrames}}`,
        `    fps={${params.fps}}`,
        `    width={${params.width}}`,
        `    height={${params.height}}`,
        `    defaultProps={{}}`,
        `  />`,
        `);`,
        ``,
        `registerRoot(RemotionRoot);`,
      ].join("\n");
      entryPoint = path.join(tmpDir, "entry.tsx");
      await fs.writeFile(entryPoint, wrapper, "utf-8");
    }

    // --- Bundle ---
    const serveUrl = await bundle({
      entryPoint,
      // Ensure webpack can resolve packages from the project root
      webpackOverride: (config) => {
        const existing = config.resolve?.modules ?? ["node_modules"];
        return {
          ...config,
          resolve: {
            ...config.resolve,
            modules: [
              ...existing,
              path.join(process.cwd(), "node_modules"),
            ],
          },
        };
      },
    });

    // --- Find composition ---
    const compositions = await getCompositions(serveUrl);
    const composition = compositions.find((c) => c.id === params.compositionId);

    if (!composition) {
      const available = compositions.map((c) => c.id).join(", ");
      throw new Error(
        `Composition "${params.compositionId}" not found in bundle. Available: ${available || "none"}`
      );
    }

    // --- Render ---
    job.status = "rendering";
    job.emitter.emit("progress", 0);

    const outputPath = path.join(tmpDir, `output.${outputExtForCodec(params.codec)}`);

    await renderMedia({
      composition,
      serveUrl,
      codec: params.codec,
      outputLocation: outputPath,
      onProgress: ({ progress }) => {
        job.progress = Math.round(progress * 100);
        job.emitter.emit("progress", job.progress);
      },
    });

    job.status = "done";
    job.outputPath = outputPath;
    job.progress = 100;
    job.emitter.emit("progress", 100);
    job.emitter.emit("done");
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Unknown error during render";
    job.status = "error";
    job.error = error;
    job.emitter.emit("error", error);
  }
}
