import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type FileKind = "image" | "raw" | "video";
export type FileEntry = { path: string; name: string; size: number; modifiedMs: number; kind: FileKind };
export type FolderListing = { folder: string; files: FileEntry[]; index: number };
export type ImageInfo = {
  path: string;
  name: string;
  size: number;
  modifiedMs: number;
  format: string;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  exposure: string | null;
  fNumber: string | null;
  iso: number | null;
  focalLength: string | null;
  gps: { lat: number; lon: number } | null;
  extra: [string, string][];
  rating: number | null;
  caption: string | null;
  keywords: string[];
  sidecar: string | null;
  writableInFile: boolean;
};
export type MetadataEdits = { rating?: number; caption?: string; keywords?: string[]; takenAt?: string };
export type WriteTarget = "sidecar" | "file";
export type WriteOutcome = { modifiedMs: number; sidecar: string | null; wroteFile: boolean };
export type ImageKind = "thumb" | "screen" | "full";
export type ImagePriority = "high" | "low";
export type TileInfo = { width: number; height: number; tileSize: number; levels: number };

export const inTauri = isTauri();
const isWindows = navigator.userAgent.includes("Windows");

export function imageUrl(file: FileEntry, kind: ImageKind, w = 0, h = 0, priority: ImagePriority = "high"): string {
  if (!inTauri) return mockImageUrl(file, kind);
  const base = isWindows ? "http://lpview.localhost" : "lpview://localhost";
  const q = new URLSearchParams({ path: file.path, v: String(file.modifiedMs) });
  if (kind === "screen") {
    q.set("w", String(Math.round(w)));
    q.set("h", String(Math.round(h)));
  }
  if (priority !== "high") q.set("p", priority);
  return `${base}/${kind}?${q.toString()}`;
}

export function tileUrl(file: FileEntry, level: number, x: number, y: number): string {
  const base = isWindows ? "http://lpview.localhost" : "lpview://localhost";
  const q = new URLSearchParams({
    path: file.path,
    v: String(file.modifiedMs),
    level: String(level),
    x: String(x),
    y: String(y),
  });
  return `${base}/tile?${q.toString()}`;
}

export async function tileInfo(path: string): Promise<TileInfo | null> {
  return inTauri ? invoke<TileInfo | null>("tile_info", { path }) : null;
}

export async function tileRelease(path: string): Promise<void> {
  if (inTauri) await invoke("tile_release", { path });
}

export async function initialPath(): Promise<string | null> {
  if (inTauri) return invoke<string | null>("initial_path");
  return mockParams.has("empty") ? null : (mockFiles[2]?.path ?? null);
}

export async function listFolder(path: string): Promise<FolderListing> {
  return inTauri ? invoke<FolderListing>("list_folder", { path }) : mockListing(path);
}

export async function imageInfo(path: string): Promise<ImageInfo> {
  return inTauri ? invoke<ImageInfo>("image_info", { path }) : mockInfo(path);
}

export async function writeMetadata(path: string, edits: MetadataEdits, target: WriteTarget): Promise<WriteOutcome> {
  if (inTauri) return invoke<WriteOutcome>("write_metadata", { path, edits, target });
  const known = mockEdits.get(path) ?? {};
  mockEdits.set(path, { ...known, ...edits });
  return { modifiedMs: mockFiles.find(f => f.path === path)?.modifiedMs ?? 0, sidecar: `${path}.xmp`, wroteFile: false };
}

export async function openExternal(url: string): Promise<void> {
  if (inTauri) await invoke("open_external", { url });
  else window.open(url, "_blank", "noopener");
}

export async function trashFile(path: string): Promise<void> {
  if (inTauri) await invoke("trash_file", { path });
}

export async function rotateFile(path: string, clockwise: boolean): Promise<number> {
  if (inTauri) return invoke<number>("rotate_file", { path, clockwise });
  mockRotation.set(path, ((mockRotation.get(path) ?? 0) + (clockwise ? 1 : 3)) % 4);
  return Date.now();
}

export async function revealInFolder(path: string): Promise<void> {
  if (inTauri) await invoke("reveal_in_folder", { path });
}

export async function copyImage(path: string): Promise<void> {
  if (inTauri) await invoke("copy_image", { path });
}

export async function prewarmThumbs(paths: string[]): Promise<number> {
  return inTauri ? invoke<number>("prewarm_thumbs", { paths }) : 0;
}

export async function openDefaultAppsSettings(): Promise<void> {
  if (inTauri) await invoke("open_default_apps_settings");
  else throw new Error("only in the desktop app");
}

export async function clearThumbnailCache(): Promise<number> {
  return inTauri ? invoke<number>("clear_cache") : 0;
}

export async function onOpenRequest(handler: (path: string) => void): Promise<UnlistenFn> {
  if (!inTauri) return () => undefined;
  return listen<{ path: string }>("viewer://open", event => handler(event.payload.path));
}

const mockParams = new URLSearchParams(inTauri ? "" : window.location.search);
const MOCK_COUNT = mockParams.has("big") ? 2000 : 40;
const mockRotation = new Map<string, number>();
const mockEdits = new Map<string, MetadataEdits>();

function mockName(i: number): string {
  const ext = i === 19 ? "mp4" : i === 12 ? "jxl" : i % 7 === 3 ? "heic" : i % 11 === 5 ? "cr3" : "jpg";
  return `IMG_${String(i + 1).padStart(4, "0")}.${ext}`;
}

const mockFiles: FileEntry[] = Array.from({ length: MOCK_COUNT }, (_, i) => {
  const name = mockName(i);
  return {
    path: `C:\\mock\\${name}`,
    name,
    size: 2_000_000 + i * 37_123,
    modifiedMs: 1_700_000_000_000 + i * 86_400_000,
    kind: name.endsWith(".cr3") ? "raw" : name.endsWith(".mp4") ? "video" : "image",
  };
});

function mockListing(path: string): FolderListing {
  const index = Math.max(0, mockFiles.findIndex(f => f.path === path));
  return { folder: "C:\\mock", files: mockFiles, index };
}

function mockSize(i: number): [number, number] {
  return i % 5 === 2 ? [3000, 4000] : [6000, 4000];
}

function mockImageUrl(file: FileEntry, kind: ImageKind): string {
  if (file.name.endsWith(".jxl") || file.kind === "video") return "data:image/png;base64,AAAA";
  const i = mockFiles.findIndex(f => f.path === file.path);
  const hue = (i * 47) % 360;
  const [w0, h0] = mockSize(i);
  const scale = kind === "thumb" ? 320 / Math.max(w0, h0) : 1;
  const [w, h] = [Math.round(w0 * scale), Math.round(h0 * scale)];
  const turns = mockRotation.get(file.path) ?? 0;
  const [ow, oh] = turns % 2 ? [h, w] : [w, h];
  const label = `${file.name} (${kind})`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${ow} ${oh}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},60%,20%)"/></linearGradient></defs>
<g transform="translate(${ow / 2} ${oh / 2}) rotate(${turns * 90}) translate(${-w / 2} ${-h / 2})">
<rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.3}" r="${h * 0.12}" fill="hsl(${(hue + 180) % 360},80%,70%)"/>
<text x="${w / 2}" y="${h * 0.55}" font-size="${h / 14}" font-family="sans-serif" fill="white" text-anchor="middle">${label}</text></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mockInfo(path: string): ImageInfo {
  const i = Math.max(0, mockFiles.findIndex(m => m.path === path));
  const f = mockFiles[i];
  if (!f) throw new Error("mock: no files");
  const [w0, h0] = mockSize(i);
  const [width, height] = (mockRotation.get(path) ?? 0) % 2 ? [h0, w0] : [w0, h0];
  return {
    path: f.path,
    name: f.name,
    size: f.size,
    modifiedMs: f.modifiedMs,
    format: f.kind === "raw" ? "Canon CR3" : f.name.endsWith(".heic") ? "HEIC" : "JPEG",
    width,
    height,
    takenAt: mockEdits.get(path)?.takenAt || new Date(f.modifiedMs).toISOString().slice(0, 19),
    cameraMake: "Canon",
    cameraModel: "EOS R6",
    lens: "RF 35mm F1.8 MACRO IS STM",
    exposure: "1/250 s",
    fNumber: "f/2.8",
    iso: 400,
    focalLength: "35 mm",
    gps: { lat: 52.52, lon: 13.405 },
    extra: [["Color space", "sRGB"]],
    rating: mockEdits.get(path)?.rating ?? null,
    caption: mockEdits.get(path)?.caption || null,
    keywords: mockEdits.get(path)?.keywords ?? [],
    sidecar: mockEdits.has(path) ? `${path}.xmp` : null,
    writableInFile: f.name.endsWith(".jpg"),
  };
}
