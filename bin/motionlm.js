#!/usr/bin/env node
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const VERSION = pkg.version ?? "0.0.0";

const VITE_PORT = 3000;
const RENDER_PORT = 3001;
const APP_URL = `http://localhost:${VITE_PORT}`;

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------

console.log("");
console.log("  MotionLM v" + VERSION);
console.log("  AI-first visual editor for Remotion compositions");
console.log("");
console.log("  Editor  →  " + APP_URL);
console.log("  Render  →  http://localhost:" + RENDER_PORT);
console.log("");
console.log("  Starting servers...");
console.log("");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves a local bin executable, falling back to npx. */
function localBin(name) {
  return path.join(ROOT, "node_modules", ".bin", name);
}

/** Opens the default browser on macOS, Linux, and Windows. */
function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  const args = process.platform === "win32" ? ["", url] : [url];
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  child.unref();
}

// ---------------------------------------------------------------------------
// Spawn processes
// ---------------------------------------------------------------------------

const viteProcess = spawn(localBin("vite"), ["--port", String(VITE_PORT)], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
});

const renderProcess = spawn(
  localBin("tsx"),
  [path.join(ROOT, "server", "render-server.ts")],
  {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  }
);

// ---------------------------------------------------------------------------
// Pipe output with prefixes, and watch for Vite ready signal
// ---------------------------------------------------------------------------

let browserOpened = false;

function prefixLines(prefix, data) {
  const lines = data.toString().split("\n");
  for (const line of lines) {
    if (line.trim()) process.stdout.write(prefix + line + "\n");
  }
}

viteProcess.stdout.on("data", (data) => {
  const text = data.toString();
  prefixLines("  [vite]   ", data);
  // Vite prints "ready in" or "Local:" when the dev server is up
  if (!browserOpened && (text.includes("Local:") || text.includes("ready in"))) {
    browserOpened = true;
    setTimeout(() => {
      console.log("");
      console.log("  Opening " + APP_URL + " ...");
      console.log("");
      openBrowser(APP_URL);
    }, 500);
  }
});

viteProcess.stderr.on("data", (data) => prefixLines("  [vite]   ", data));

renderProcess.stdout.on("data", (data) => prefixLines("  [render] ", data));
renderProcess.stderr.on("data", (data) => prefixLines("  [render] ", data));

// ---------------------------------------------------------------------------
// Error handling for child processes
// ---------------------------------------------------------------------------

viteProcess.on("error", (err) => {
  console.error("  [vite]   Failed to start:", err.message);
});

renderProcess.on("error", (err) => {
  console.error("  [render] Failed to start:", err.message);
});

viteProcess.on("exit", (code, signal) => {
  if (signal !== "SIGTERM" && signal !== "SIGINT") {
    console.error(`  [vite]   Exited unexpectedly (code=${code ?? "?"}, signal=${signal ?? "none"})`);
  }
});

renderProcess.on("exit", (code, signal) => {
  if (signal !== "SIGTERM" && signal !== "SIGINT") {
    console.error(`  [render] Exited unexpectedly (code=${code ?? "?"}, signal=${signal ?? "none"})`);
  }
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown() {
  console.log("");
  console.log("  Shutting down...");
  viteProcess.kill("SIGTERM");
  renderProcess.kill("SIGTERM");
  // Force-kill after 3s if they haven't exited
  setTimeout(() => {
    viteProcess.kill("SIGKILL");
    renderProcess.kill("SIGKILL");
    process.exit(0);
  }, 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
