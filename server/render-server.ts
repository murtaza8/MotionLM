import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { z } from "zod";

import { handleRender, getRenderJob, handleRenderStill } from "./render-handler.ts";

// ---------------------------------------------------------------------------
// Input validation schema
// ---------------------------------------------------------------------------

const RenderRequestSchema = z.object({
  /** VFS contents: path → source code */
  vfs: z.record(z.string(), z.string()),
  /** Remotion composition ID to render (must match the id in registerRoot) */
  compositionId: z.string().default("Main"),
  durationInFrames: z.number().int().positive(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  codec: z
    .enum(["h264", "h265", "vp8", "vp9", "prores", "gif"])
    .default("h264"),
});

const RenderStillSchema = z.object({
  files: z.record(z.string(), z.string()),
  /** VFS path of the entry file, e.g. "/billiard-shot.tsx". When omitted the
   *  handler falls back to /main.tsx → main.tsx → first file. */
  entryPath: z.string().optional(),
  compositionId: z.string().default("Main"),
  frame: z.number().int().min(0),
  width: z.number().int().positive().default(854),
  height: z.number().int().positive().default(480),
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  })
);
app.use(express.json({ limit: "10mb" }));

// ---------------------------------------------------------------------------
// POST /api/render — start a render job
// ---------------------------------------------------------------------------

app.post("/api/render", async (req, res) => {
  const parsed = RenderRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    res.status(400).json({ ok: false, error: `Invalid request: ${message}` });
    return;
  }

  const result = await handleRender(parsed.data);
  if (!result.ok) {
    res.status(500).json({ ok: false, error: result.error });
    return;
  }

  res.json({ ok: true, renderId: result.renderId });
});

// ---------------------------------------------------------------------------
// POST /api/render/still — render a single frame as PNG (base64)
// ---------------------------------------------------------------------------

app.post("/api/render/still", async (req, res) => {
  const parsed = RenderStillSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    res.status(400).json({ ok: false, error: `Invalid request: ${message}` });
    return;
  }

  const result = await handleRenderStill(parsed.data);
  if (!result.ok) {
    res.status(500).json({ ok: false, error: result.error });
    return;
  }

  res.json({ ok: true, data: result.data });
});

// ---------------------------------------------------------------------------
// GET /api/render/:id/progress — SSE progress stream
// ---------------------------------------------------------------------------

app.get("/api/render/:id/progress", (req, res) => {
  const job = getRenderJob(req.params.id ?? "");
  if (!job) {
    res.status(404).json({ ok: false, error: "Render job not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // If already finished, send terminal state immediately
  if (job.status === "done") {
    send("progress", { progress: 100 });
    send("done", { ok: true });
    res.end();
    return;
  }

  if (job.status === "error") {
    send("error", { error: job.error ?? "Unknown error" });
    res.end();
    return;
  }

  // Send current snapshot
  send("progress", { progress: job.progress });

  // Subscribe to future updates
  const onProgress = (progress: number): void => {
    send("progress", { progress });
  };
  const onDone = (): void => {
    send("progress", { progress: 100 });
    send("done", { ok: true });
    res.end();
  };
  const onError = (error: string): void => {
    send("error", { error });
    res.end();
  };

  job.emitter.on("progress", onProgress);
  job.emitter.once("done", onDone);
  job.emitter.once("error", onError);

  req.on("close", () => {
    job.emitter.off("progress", onProgress);
    job.emitter.off("done", onDone);
    job.emitter.off("error", onError);
  });
});

// ---------------------------------------------------------------------------
// GET /api/render/:id/status — one-shot status check (no SSE)
// ---------------------------------------------------------------------------

app.get("/api/render/:id/status", (req, res) => {
  const job = getRenderJob(req.params.id ?? "");
  if (!job) {
    res.status(404).json({ ok: false, error: "Render job not found" });
    return;
  }

  res.json({
    ok: true,
    status: job.status,
    progress: job.progress,
    error: job.error,
  });
});

// ---------------------------------------------------------------------------
// GET /api/render/:id/download — stream the completed file
// ---------------------------------------------------------------------------

app.get("/api/render/:id/download", (req, res) => {
  const job = getRenderJob(req.params.id ?? "");
  if (!job) {
    res.status(404).json({ ok: false, error: "Render job not found" });
    return;
  }

  if (job.status !== "done" || !job.outputPath) {
    res.status(400).json({
      ok: false,
      error: job.status === "error" ? (job.error ?? "Render failed") : "Render not complete",
    });
    return;
  }

  if (!fs.existsSync(job.outputPath)) {
    res.status(410).json({ ok: false, error: "Output file no longer available" });
    return;
  }

  const filename = `motionlm-export.${job.outputExt}`;
  const contentType = job.outputExt === "gif" ? "image/gif" : "video/mp4";

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", contentType);

  const stream = fs.createReadStream(job.outputPath);
  stream.pipe(res);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "Failed to stream output file" });
    }
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = 3001;

app.listen(PORT, () => {
  console.log(`MotionLM render server listening on http://localhost:${PORT}`);
});
