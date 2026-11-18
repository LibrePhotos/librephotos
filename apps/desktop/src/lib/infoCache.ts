import { useEffect, useState } from "react";
import { imageInfo, type FileEntry, type ImageInfo } from "../ipc";

/** `image_info` results per path + mtime, shared by the stage (for 100 % zoom) and the info panel. */
const pending = new Map<string, Promise<ImageInfo>>();
const settled = new Map<string, ImageInfo>();

const keyOf = (file: FileEntry) => `${file.path}|${file.modifiedMs}`;

export function peekInfo(file: FileEntry): ImageInfo | null {
  return settled.get(keyOf(file)) ?? null;
}

export function getInfo(file: FileEntry): Promise<ImageInfo> {
  const key = keyOf(file);
  const known = settled.get(key);
  if (known) return Promise.resolve(known);
  let promise = pending.get(key);
  if (!promise) {
    promise = imageInfo(file.path).then(
      info => {
        settled.set(key, info);
        pending.delete(key);
        return info;
      },
      (err: unknown) => {
        pending.delete(key);
        throw err;
      },
    );
    pending.set(key, promise);
  }
  return promise;
}

export type InfoState =
  | { status: "loading" }
  | { status: "ready"; info: ImageInfo }
  | { status: "error"; error: string };

export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

/** Info for `file`, fetched after `delayMs` so flipping fast through a folder doesn't flood Rust. */
export function useImageInfo(file: FileEntry | null, delayMs = 80): InfoState {
  const key = file ? keyOf(file) : "";
  const [state, setState] = useState<{ key: string; value: InfoState }>({ key: "", value: { status: "loading" } });

  useEffect(() => {
    if (!file || peekInfo(file)) return;
    let live = true;
    const timer = window.setTimeout(() => {
      getInfo(file).then(
        info => live && setState({ key, value: { status: "ready", info } }),
        (err: unknown) => live && setState({ key, value: { status: "error", error: errorText(err) } }),
      );
    }, delayMs);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // `key` identifies the file (path + mtime); the object itself may be re-created.
  }, [key, delayMs]);

  if (!file) return { status: "loading" };
  const known = peekInfo(file);
  if (known) return { status: "ready", info: known };
  return state.key === key ? state.value : { status: "loading" };
}
