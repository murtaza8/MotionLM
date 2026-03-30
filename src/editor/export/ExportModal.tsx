import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Download, RotateCcw } from "lucide-react";

import { useStore } from "@/store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportPhase =
  | { phase: "idle" }
  | { phase: "rendering"; renderId: string; progress: number }
  | { phase: "done"; renderId: string }
  | { phase: "error"; message: string };

// ---------------------------------------------------------------------------
// ExportModal
// ---------------------------------------------------------------------------

export const ExportModal = () => {
  const exportModalOpen = useStore((s) => s.exportModalOpen);
  const closeExportModal = useStore((s) => s.closeExportModal);
  const files = useStore((s) => s.files);
  const durationInFrames = useStore((s) => s.durationInFrames);
  const fps = useStore((s) => s.fps);

  const [state, setState] = useState<ExportPhase>({ phase: "idle" });
  const esRef = useRef<EventSource | null>(null);

  // Reset to idle whenever the modal opens
  useEffect(() => {
    if (exportModalOpen) {
      setState({ phase: "idle" });
    }
  }, [exportModalOpen]);

  // Clean up EventSource when modal closes
  useEffect(() => {
    if (!exportModalOpen) {
      esRef.current?.close();
      esRef.current = null;
    }
  }, [exportModalOpen]);

  const startRender = async () => {
    const vfs: Record<string, string> = {};
    for (const [path, file] of files.entries()) {
      vfs[path] = file.activeCode;
    }

    let renderId: string;

    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vfs,
          compositionId: "Main",
          durationInFrames,
          fps,
          width: 1920,
          height: 1080,
          codec: "h264",
        }),
      });

      const json = (await res.json()) as { ok: boolean; renderId?: string; error?: string };

      if (!json.ok || !json.renderId) {
        setState({ phase: "error", message: json.error ?? "Failed to start render" });
        return;
      }

      renderId = json.renderId;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setState({ phase: "error", message });
      return;
    }

    setState({ phase: "rendering", renderId, progress: 0 });

    const es = new EventSource(`/api/render/${renderId}/progress`);
    esRef.current = es;

    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data) as { progress: number };
      setState({ phase: "rendering", renderId, progress: Math.round(data.progress) });
    });

    es.addEventListener("done", () => {
      es.close();
      esRef.current = null;
      setState({ phase: "done", renderId });
    });

    es.addEventListener("error", (e) => {
      es.close();
      esRef.current = null;
      let message = "Render failed";
      try {
        const data = JSON.parse((e as MessageEvent).data) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // ignore parse error — use default message
      }
      setState({ phase: "error", message });
    });
  };

  const cancelRender = () => {
    esRef.current?.close();
    esRef.current = null;
    setState({ phase: "idle" });
  };

  return (
    <Dialog.Root open={exportModalOpen} onOpenChange={(open) => !open && closeExportModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[400px] glass-elevated rounded-xl border border-[var(--glass-border-subtle)] p-6 shadow-2xl focus:outline-none">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-sm font-semibold text-[var(--text-primary)]">
              Export video
            </Dialog.Title>
            <Dialog.Close
              className="p-1 rounded glass-hover text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {state.phase === "idle" && (
            <div className="space-y-4">
              <div className="text-xs text-[var(--text-secondary)] space-y-1">
                <div className="flex justify-between">
                  <span>Format</span>
                  <span className="text-[var(--text-primary)]">MP4 (H.264)</span>
                </div>
                <div className="flex justify-between">
                  <span>Resolution</span>
                  <span className="text-[var(--text-primary)]">1920 × 1080</span>
                </div>
                <div className="flex justify-between">
                  <span>Duration</span>
                  <span className="text-[var(--text-primary)]">
                    {(durationInFrames / fps).toFixed(2)}s ({durationInFrames} frames @ {fps} fps)
                  </span>
                </div>
              </div>

              <button
                onClick={startRender}
                className="w-full py-2 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Render
              </button>
            </div>
          )}

          {state.phase === "rendering" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                  <span>Rendering…</span>
                  <span>{state.progress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--glass-border-subtle)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${state.progress}%` }}
                  />
                </div>
              </div>

              <button
                onClick={cancelRender}
                className="w-full py-2 rounded text-xs font-medium glass-hover text-[var(--text-secondary)] border border-[var(--glass-border-subtle)] transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {state.phase === "done" && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-secondary)]">Render complete.</p>

              <a
                href={`/api/render/${state.renderId}/download`}
                download="motionlm-export.mp4"
                className="flex items-center justify-center gap-2 w-full py-2 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download MP4
              </a>

              <button
                onClick={() => setState({ phase: "idle" })}
                className="flex items-center justify-center gap-2 w-full py-2 rounded text-xs font-medium glass-hover text-[var(--text-secondary)] border border-[var(--glass-border-subtle)] transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Render again
              </button>
            </div>
          )}

          {state.phase === "error" && (
            <div className="space-y-3">
              <p className="text-xs text-red-400">{state.message}</p>

              <button
                onClick={() => setState({ phase: "idle" })}
                className="w-full py-2 rounded text-xs font-medium glass-hover text-[var(--text-secondary)] border border-[var(--glass-border-subtle)] transition-colors"
              >
                Try again
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
