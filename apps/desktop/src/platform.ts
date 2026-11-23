import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "./ipc";

export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "hif", "avif", "jxl"];
export const RAW_EXTENSIONS = ["dng", "cr2", "cr3", "nef", "nrw", "arw", "srf", "sr2", "orf", "rw2", "raf", "pef", "srw", "raw", "rwl", "3fr", "erf", "kdc", "mrw", "x3f"];
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "mkv", "avi"];

export function setWindowTitle(title: string): void {
  if (inTauri) void getCurrentWindow().setTitle(title).catch(() => undefined);
  else document.title = title;
}

export async function setFullscreen(on: boolean): Promise<void> {
  if (inTauri) {
    await getCurrentWindow().setFullscreen(on);
    return;
  }
  if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
  if (!on && document.fullscreenElement) await document.exitFullscreen();
}

export function onFullscreenChange(handler: (on: boolean) => void): () => void {
  if (!inTauri) {
    const listener = () => handler(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }
  const win = getCurrentWindow();
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  void win
    .onResized(() => {
      void win.isFullscreen().then(handler, () => undefined);
    })
    .then(fn => {
      if (disposed) fn();
      else unlisten = fn;
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export function focusWindow(): void {
  if (!inTauri) return;
  const win = getCurrentWindow();
  void win
    .unminimize()
    .then(() => win.setFocus())
    .catch(() => undefined);
}

export async function pickFile(): Promise<string | null> {
  if (!inTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    directory: false,
    title: "Open a picture",
    filters: [
      { name: "Pictures and videos", extensions: [...IMAGE_EXTENSIONS, ...RAW_EXTENSIONS, ...VIDEO_EXTENSIONS] },
      { name: "Pictures", extensions: IMAGE_EXTENSIONS },
      { name: "RAW photos", extensions: RAW_EXTENSIONS },
      { name: "Videos", extensions: VIDEO_EXTENSIONS },
    ],
  });
  return typeof picked === "string" ? picked : null;
}

export type DropHandlers = { onHover: (hovering: boolean) => void; onDrop: (path: string) => void };

export function onFileDrop({ onHover, onDrop }: DropHandlers): () => void {
  if (!inTauri) return () => undefined;
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  void getCurrentWebview()
    .onDragDropEvent(event => {
      const p = event.payload;
      if (p.type === "enter") onHover(p.paths.length > 0);
      else if (p.type === "leave") onHover(false);
      else if (p.type === "drop") {
        onHover(false);
        const first = p.paths[0];
        if (first) onDrop(first);
      }
    })
    .then(fn => {
      if (disposed) fn();
      else unlisten = fn;
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}
