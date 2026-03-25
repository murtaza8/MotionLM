import { X, History } from "lucide-react";

import { useStore } from "@/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatRelative = (timestamp: number): string => {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
};

// ---------------------------------------------------------------------------
// VersionHistory
// ---------------------------------------------------------------------------

export const VersionHistory = () => {
  const open = useStore((s) => s.versionHistoryOpen);
  const closeVersionHistory = useStore((s) => s.closeVersionHistory);
  const snapshots = useStore((s) => s.snapshots);
  const currentSnapshotIndex = useStore((s) => s.currentSnapshotIndex);
  const restoreSnapshot = useStore((s) => s.restoreSnapshot);

  return (
    <div
      className={`fixed top-[44px] right-0 bottom-[160px] w-[280px] z-40 flex flex-col glass-modal border-l border-[var(--glass-border-subtle)] transition-transform duration-300 ease-[var(--ease-glass)] ${open ? "translate-x-0" : "translate-x-full"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--glass-border-subtle)] shrink-0">
        <div className="flex items-center gap-2">
          <History className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <span className="text-xs font-medium uppercase tracking-widest text-[var(--text-tertiary)]">
            History
          </span>
        </div>
        <button
          onClick={closeVersionHistory}
          className="p-1 rounded glass-hover text-[var(--text-tertiary)]"
          aria-label="Close version history"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Snapshot list */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {snapshots.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)] px-2 py-4 text-center">
            No history yet. Edits applied via Claude will appear here.
          </p>
        ) : (
          [...snapshots].reverse().map((snapshot, reversedIdx) => {
            const originalIndex = snapshots.length - 1 - reversedIdx;
            const isCurrent = originalIndex === currentSnapshotIndex;
            return (
              <button
                key={snapshot.id}
                onClick={() => restoreSnapshot(snapshot.id)}
                className={`w-full text-left px-3 py-2 rounded glass-well glass-hover flex flex-col gap-0.5 ${isCurrent ? "glass-tint-blue" : ""}`}
              >
                <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                  {snapshot.description || "Edit"}
                </span>
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  {formatRelative(snapshot.timestamp)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
