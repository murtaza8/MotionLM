import React, { useEffect, useRef, useState } from "react";
import { Player } from "@remotion/player";
import type { PlayerRef, CallbackListener } from "@remotion/player";

import { compileAsync } from "@/engine/compiler-bridge";
import { useStore } from "@/store";
import {
  SIMPLE_TEXT_SOURCE,
  SIMPLE_TEXT_DURATION,
} from "@/samples/simple-text";
import { Overlay } from "@/inspector/Overlay";

const SAMPLE_FILE_PATH = "/samples/simple-text.tsx";
const COMPOSITION_WIDTH = 1920;
const COMPOSITION_HEIGHT = 1080;
const FPS = 30;
const DEFAULT_DURATION = 150;

// ---------------------------------------------------------------------------
// PreviewPanel
// ---------------------------------------------------------------------------

export const PreviewPanel = () => {
  const setActiveCode = useStore((s) => s.setActiveCode);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const setCompilationStatus = useStore((s) => s.setCompilationStatus);
  const setCompositionMeta = useStore((s) => s.setCompositionMeta);
  const isPlaying = useStore((s) => s.isPlaying);
  const setPlaying = useStore((s) => s.setPlaying);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);
  const durationInFrames = useStore((s) => s.durationInFrames);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const activeFileStatus = useStore((s) =>
    s.activeFilePath ? s.files.get(s.activeFilePath)?.compilationStatus ?? "idle" : "idle"
  );
  const activeFileError = useStore((s) =>
    s.activeFilePath ? s.files.get(s.activeFilePath)?.compilationError ?? null : null
  );
  const activeFileCode = useStore((s) => {
    if (!s.activeFilePath) return "";
    const f = s.files.get(s.activeFilePath);
    return f ? (f.draftCode ?? f.activeCode) : "";
  });
  const editMode = useStore((s) => s.editMode);

  // A stable string key that changes when any file's content changes,
  // used to trigger recompilation when dependencies are edited.
  const filesKey = useStore((s) => {
    const parts: string[] = [];
    for (const [path, file] of s.files) {
      parts.push(`${path}:${file.draftCode ?? file.activeCode}`);
    }
    return parts.join("|");
  });

  const [component, setComponent] = useState<React.ComponentType | null>(null);
  const playerRef = useRef<PlayerRef>(null);

  // The panel container — we measure this to compute Player display dimensions.
  const panelRef = useRef<HTMLDivElement>(null);
  // The wrapper that is sized to exactly the Player's display dimensions.
  // The Overlay is positioned absolutely inside this wrapper.
  const playerContainerRef = useRef<HTMLDivElement>(null);

  // Explicit pixel size for the Player. Remotion scales the composition to fit
  // these dimensions. Using ResizeObserver (instead of CSS percentages) avoids
  // a chicken-and-egg problem where the Player's iframe expands the container
  // before Remotion's internal ResizeObserver fires, causing scale=1.
  const [playerSize, setPlayerSize] = useState({ width: 0, height: 0 });

  // Load sample into VFS on mount — skip if VFS was restored from IDB
  useEffect(() => {
    const { files } = useStore.getState();
    if (files.size > 0) return;
    setActiveCode(SAMPLE_FILE_PATH, SIMPLE_TEXT_SOURCE);
    setActiveFile(SAMPLE_FILE_PATH);
    setCompositionMeta(SIMPLE_TEXT_DURATION, FPS);
  }, [setActiveCode, setActiveFile, setCompositionMeta]);

  // Compile whenever any VFS file content changes or the active file switches.
  // compileAsync offloads the Babel transform to a Web Worker; new Function()
  // runs on the main thread once the worker responds.
  // The stale-check (compilingPath !== activeFilePath) discards results from
  // races where the active file changed while a compile was in-flight.
  useEffect(() => {
    if (!activeFilePath) return;

    const compilingPath = activeFilePath;
    const { files } = useStore.getState();
    const sourcesMap = new Map<string, string>();
    for (const [path, file] of files) {
      const src = file.draftCode ?? file.activeCode;
      if (src) sourcesMap.set(path, src);
    }

    setCompilationStatus(compilingPath, "compiling");

    void compileAsync(compilingPath, sourcesMap).then((result) => {
      // Discard stale result if active file switched mid-compile
      if (useStore.getState().activeFilePath !== compilingPath) return;

      if (result.ok) {
        setComponent(() => result.Component);
        setCompilationStatus(compilingPath, "success");
      } else {
        setComponent(null);
        setCompilationStatus(compilingPath, "error", result.error);
      }
    });
  }, [filesKey, activeFilePath, setCompilationStatus]);

  // Measure the panel container and compute the largest Player size that fits
  // while maintaining the 1920×1080 aspect ratio.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const scale = Math.min(
        width / COMPOSITION_WIDTH,
        height / COMPOSITION_HEIGHT
      );
      setPlayerSize({
        width: Math.floor(COMPOSITION_WIDTH * scale),
        height: Math.floor(COMPOSITION_HEIGHT * scale),
      });
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Drive the Player from the store's isPlaying so cross-slice actions
  // (e.g. edit mode activating) actually pause the Player.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) {
      player.play();
    } else {
      player.pause();
    }
  }, [isPlaying]);

  // Sync Player events to playerSlice
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const onPlay: CallbackListener<"play"> = () => setPlaying(true);
    const onPause: CallbackListener<"pause"> = () => setPlaying(false);
    const onFrameUpdate: CallbackListener<"frameupdate"> = ({ detail }) =>
      setCurrentFrame(detail.frame);
    const onError: CallbackListener<"error"> = ({ detail }) => {
      if (activeFilePath) {
        setCompilationStatus(
          activeFilePath,
          "error",
          `Render error: ${detail.error.message}`
        );
      }
    };

    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("frameupdate", onFrameUpdate);
    player.addEventListener("error", onError);

    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("frameupdate", onFrameUpdate);
      player.removeEventListener("error", onError);
    };
  }, [component, activeFilePath, setPlaying, setCurrentFrame, setCompilationStatus]);

  const hasSize = playerSize.width > 0 && playerSize.height > 0;

  return (
    // panelRef fills the grid cell. We measure it to compute the Player size.
    <div
      ref={panelRef}
      className="flex h-full w-full items-center justify-center overflow-hidden p-4"
    >
      {!component || !hasSize ? (
        <span className="text-sm text-[var(--text-tertiary)] text-center px-4">
          {activeFileStatus === "compiling"
            ? "Compiling..."
            : activeFileStatus === "error" && !activeFileCode.trim()
            ? "File is empty — describe what to build in the chat."
            : activeFileStatus === "error" && activeFileError
            ? activeFileError
            : !hasSize
            ? ""
            : "Compiling..."}
        </span>
      ) : (
        // playerContainerRef is sized to exactly the computed Player dimensions.
        // The Overlay sits absolutely inside this wrapper so its coordinate
        // space matches the Player's rendered area precisely.
        <div
          ref={playerContainerRef}
          className="relative overflow-hidden"
          style={{ width: playerSize.width, height: playerSize.height }}
        >
          <Player
            ref={playerRef}
            component={
              component as React.ComponentType<Record<string, unknown>>
            }
            compositionWidth={COMPOSITION_WIDTH}
            compositionHeight={COMPOSITION_HEIGHT}
            fps={FPS}
            durationInFrames={durationInFrames > 0 ? durationInFrames : DEFAULT_DURATION}
            controls={!editMode}
            loop
            style={{ width: playerSize.width, height: playerSize.height }}
            acknowledgeRemotionLicense
          />
          <Overlay containerRef={playerContainerRef} />
        </div>
      )}
    </div>
  );
};
