import { useState, useRef } from "react";
import { BookOpen, FileCode2, FilePlus, Save, Trash2, Upload } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

import { useStore, VFS_MAX_FILES, VFS_SOFT_SIZE_LIMIT, selectTotalCodeSize } from "@/store";
import { openFileFromDisk, saveFileToDisk } from "@/persistence/filesystem";

import { SIMPLE_TEXT_SOURCE } from "@/samples/simple-text";
import { MULTI_SEQUENCE_SOURCE } from "@/samples/multi-sequence";
import { SPRING_ANIMATION_SOURCE } from "@/samples/spring-animation";
import { NESTED_COMPONENTS_SOURCE } from "@/samples/nested-components";
import { COMPLEX_TIMELINE_SOURCE } from "@/samples/complex-timeline";

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES: ReadonlyArray<{ id: string; label: string; filename: string; source: string }> = [
  { id: "simple-text", label: "Simple Text Animation", filename: "simple-text.tsx", source: SIMPLE_TEXT_SOURCE },
  { id: "multi-sequence", label: "Multi-Sequence Layout", filename: "multi-sequence.tsx", source: MULTI_SEQUENCE_SOURCE },
  { id: "spring-animation", label: "Spring Animation", filename: "spring-animation.tsx", source: SPRING_ANIMATION_SOURCE },
  { id: "nested-components", label: "Nested Components", filename: "nested-components.tsx", source: NESTED_COMPONENTS_SOURCE },
  { id: "complex-timeline", label: "Complex Timeline", filename: "complex-timeline.tsx", source: COMPLEX_TIMELINE_SOURCE },
];

// ---------------------------------------------------------------------------
// FileTreePanel
// ---------------------------------------------------------------------------

export const FileTreePanel = () => {
  const files = useStore((s) => s.files);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const createFile = useStore((s) => s.createFile);
  const deleteFile = useStore((s) => s.deleteFile);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const fileEntries = Array.from(files.entries());

  const checkCanCreateFile = (): boolean => {
    if (files.size >= VFS_MAX_FILES) {
      window.alert(
        `File limit reached. You can have at most ${VFS_MAX_FILES} files open at once. Delete a file to create a new one.`
      );
      return false;
    }
    const totalSize = selectTotalCodeSize(files);
    if (totalSize >= VFS_SOFT_SIZE_LIMIT) {
      return window.confirm(
        `Your workspace is using over 5 MB of source code. Adding more files may slow down the editor. Continue anyway?`
      );
    }
    return true;
  };

  const handleDeleteFile = () => {
    if (!activeFilePath) return;
    const confirmed = window.confirm(
      `Delete "${activeFilePath}"? This cannot be undone.`
    );
    if (!confirmed) return;
    deleteFile(activeFilePath);
  };

  const handleNewFile = () => {
    if (!checkCanCreateFile()) return;
    const input = window.prompt("File name (e.g. my-comp.tsx):");
    if (!input) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    createFile(path, "");
    setActiveFile(path);
  };

  const handleOpen = async () => {
    if (!checkCanCreateFile()) return;
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

  const handleLoadTemplate = (template: typeof TEMPLATES[number]) => {
    const path = `/${template.filename}`;
    if (files.has(path)) {
      const confirmed = window.confirm(`"${template.filename}" already exists. Overwrite?`);
      if (!confirmed) return;
    } else if (!checkCanCreateFile()) {
      return;
    }
    createFile(path, template.source);
    setActiveFile(path);
    setTemplatesOpen(false);
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
      <div className="p-2 border-t border-[var(--glass-border-subtle)] flex flex-wrap gap-1">
        {/* Templates popover */}
        <Popover.Root open={templatesOpen} onOpenChange={setTemplatesOpen}>
          <Popover.Trigger asChild>
            <button
              className="flex items-center gap-1 px-2 py-1.5 rounded text-xs glass-hover text-[var(--text-secondary)]"
              title="Load a template"
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span>Templates</span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="start"
              sideOffset={6}
              className="z-50 w-64 rounded-lg glass-panel border border-[var(--glass-border-subtle)] shadow-xl p-2"
            >
              <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--text-tertiary)] px-1 pb-1.5">Templates</p>
              <div className="flex flex-col gap-0.5">
                {TEMPLATES.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded glass-hover">
                    <span className="text-xs text-[var(--text-primary)] truncate">{t.label}</span>
                    <button
                      type="button"
                      onClick={() => handleLoadTemplate(t)}
                      className="shrink-0 text-[10px] text-blue-300 hover:text-blue-200 font-medium"
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
              <Popover.Arrow className="fill-[var(--glass-border-subtle)]" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <button
          onClick={handleNewFile}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs glass-hover text-[var(--text-secondary)]"
          title="New file"
        >
          <FilePlus className="w-3.5 h-3.5 shrink-0" />
          <span>New</span>
        </button>
        <button
          onClick={handleOpen}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-xs glass-hover text-[var(--text-secondary)]"
          title="Open .tsx / .ts file from disk"
        >
          <Upload className="w-3.5 h-3.5 shrink-0" />
        </button>
        <button
          onClick={handleSave}
          disabled={!activeFilePath}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-xs glass-hover text-[var(--text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
          title="Save active file (Cmd+S)"
        >
          <Save className="w-3.5 h-3.5 shrink-0" />
        </button>
        <button
          onClick={handleDeleteFile}
          disabled={!activeFilePath}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:text-red-400 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Delete active file"
        >
          <Trash2 className="w-3.5 h-3.5 shrink-0" />
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
