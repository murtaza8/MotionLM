import { FileCode2, FilePlus, Save, Upload } from "lucide-react";
import { useRef } from "react";

import { useStore } from "@/store";
import { openFileFromDisk, saveFileToDisk } from "@/persistence/filesystem";

export const FileTreePanel = () => {
  const files = useStore((s) => s.files);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const createFile = useStore((s) => s.createFile);

  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleOpen = async () => {
    const result = await openFileFromDisk();
    if (!result.ok) {
      // FSAA not supported — fall back to hidden file input
      fileInputRef.current?.click();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "tsx" && ext !== "ts") {
      alert("Only .tsx and .ts files are supported.");
      return;
    }

    let path = `/${file.name}`;
    if (files.has(path)) {
      const base = file.name.replace(/\.(tsx|ts)$/, "");
      const suffix = ext;
      let i = 1;
      while (files.has(`/${base}-${i}.${suffix}`)) i++;
      path = `/${base}-${i}.${suffix}`;
    }

    const reader = new FileReader();
    reader.onload = (event: ProgressEvent<FileReader>) => {
      const content = event.target?.result;
      if (typeof content !== "string") return;
      createFile(path, content);
      setActiveFile(path);
    };
    reader.onerror = () => {
      alert("Failed to read the file. Please try again.");
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    if (!activeFilePath) return;
    await saveFileToDisk(activeFilePath);
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
      <div className="p-2 border-t border-[var(--glass-border-subtle)] flex gap-1">
        <button
          onClick={handleNewFile}
          className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded text-sm glass-hover text-[var(--text-secondary)]"
        >
          <FilePlus className="w-4 h-4 shrink-0" />
          <span>New File</span>
        </button>
        <button
          onClick={handleOpen}
          className="flex items-center gap-2 px-3 py-1.5 rounded text-sm glass-hover text-[var(--text-secondary)]"
          title="Open .tsx / .ts file from disk"
        >
          <Upload className="w-4 h-4 shrink-0" />
        </button>
        <button
          onClick={handleSave}
          disabled={!activeFilePath}
          className="flex items-center gap-2 px-3 py-1.5 rounded text-sm glass-hover text-[var(--text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
          title="Save active file (Cmd+S)"
        >
          <Save className="w-4 h-4 shrink-0" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tsx,.ts"
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>
    </div>
  );
};
