import { useStore } from "@/store";

// ---------------------------------------------------------------------------
// Minimal ambient types for File System Access API
// TypeScript's DOM lib does not yet expose these as global functions.
// ---------------------------------------------------------------------------

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
}

interface SaveFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  suggestedName?: string;
}

declare function showOpenFilePicker(
  options?: OpenFilePickerOptions
): Promise<FileSystemFileHandle[]>;

declare function showSaveFilePicker(
  options?: SaveFilePickerOptions
): Promise<FileSystemFileHandle>;

// ---------------------------------------------------------------------------

type FSResult = { ok: true } | { ok: false; error: string };

const hasFSAA = (): boolean => "showOpenFilePicker" in globalThis;

/**
 * Open a .tsx / .ts file from disk using the File System Access API.
 * Returns { ok: false } when FSAA is unavailable — callers should fall back
 * to the hidden <input type="file"> in that case.
 */
export const openFileFromDisk = async (): Promise<FSResult> => {
  if (!hasFSAA()) {
    return {
      ok: false,
      error:
        "File System Access API is not supported in this browser. Use the upload button instead.",
    };
  }

  let fileHandle: FileSystemFileHandle;
  try {
    const [handle] = await showOpenFilePicker({
      types: [
        {
          description: "TypeScript / TSX files",
          accept: { "text/typescript": [".ts", ".tsx"] },
        },
      ],
      multiple: false,
    });
    fileHandle = handle;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: true }; // user cancelled — not an error
    }
    return { ok: false, error: "Failed to open file picker." };
  }

  try {
    const file = await fileHandle.getFile();
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "tsx" && ext !== "ts") {
      return { ok: false, error: "Only .tsx and .ts files are supported." };
    }
    const content = await file.text();

    const { files, createFile, setActiveFile, setFileHandle } =
      useStore.getState();
    let path = `/${file.name}`;
    if (files.has(path)) {
      const base = file.name.replace(/\.(tsx|ts)$/, "");
      let i = 1;
      while (files.has(`/${base}-${i}.${ext}`)) i++;
      path = `/${base}-${i}.${ext}`;
    }

    createFile(path, content);
    setActiveFile(path);
    setFileHandle(path, fileHandle);
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to read the file." };
  }
};

/**
 * Save the active file to disk.
 * - Existing FSAA handle: writes silently.
 * - No handle + FSAA available: shows Save As dialog and stores the handle.
 * - FSAA unavailable: falls back to a Blob download.
 */
export const saveFileToDisk = async (path: string): Promise<FSResult> => {
  const { files, fileHandles, setFileHandle } = useStore.getState();
  const file = files.get(path);
  if (!file) return { ok: false, error: "File not found in VFS." };

  const content = file.activeCode;
  const existingHandle = fileHandles.get(path);

  let handle: FileSystemFileHandle;

  if (existingHandle) {
    handle = existingHandle;
  } else if (!hasFSAA()) {
    // Fallback: trigger a browser download
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = path.split("/").pop() ?? "composition.tsx";
    anchor.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  } else {
    try {
      const newHandle = await showSaveFilePicker({
        suggestedName: path.split("/").pop() ?? "composition.tsx",
        types: [
          {
            description: "TypeScript / TSX file",
            accept: { "text/typescript": [".ts", ".tsx"] },
          },
        ],
      });
      setFileHandle(path, newHandle);
      handle = newHandle;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: true }; // user cancelled
      }
      return { ok: false, error: "Failed to open save dialog." };
    }
  }

  try {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to write file to disk." };
  }
};
