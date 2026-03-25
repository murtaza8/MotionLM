import { FileCode2, FilePlus } from "lucide-react";

import { useStore } from "@/store";

export const FileTreePanel = () => {
  const files = useStore((s) => s.files);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const createFile = useStore((s) => s.createFile);

  const fileEntries = Array.from(files.entries());

  const handleNewFile = () => {
    const input = window.prompt("File name (e.g. my-comp.tsx):");
    if (!input) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    createFile(path, "");
    setActiveFile(path);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {fileEntries.map(([path, file]) => {
          const basename = path.split("/").pop() ?? path;
          const isActive = path === activeFilePath;

          let dotClass: string | null = null;
          if (file.compilationStatus === "error") {
            dotClass = "bg-red-500";
          } else if (file.draftCode !== null) {
            dotClass = "bg-amber-400";
          } else if (file.compilationStatus === "success") {
            dotClass = "bg-green-500";
          }

          return (
            <button
              key={path}
              onClick={() => setActiveFile(path)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm glass-hover ${isActive ? "glass-tint-blue" : ""}`}
            >
              <FileCode2 className="w-4 h-4 shrink-0 text-[var(--text-tertiary)]" />
              <span className="flex-1 truncate text-[var(--text-primary)]">
                {basename}
              </span>
              {dotClass !== null && (
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="p-2 border-t border-[var(--glass-border-subtle)]">
        <button
          onClick={handleNewFile}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm glass-hover text-[var(--text-secondary)]"
        >
          <FilePlus className="w-4 h-4 shrink-0" />
          <span>New File</span>
        </button>
      </div>
    </div>
  );
};
