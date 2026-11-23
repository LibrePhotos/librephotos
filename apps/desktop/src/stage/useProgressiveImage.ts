import { useCallback, useEffect, useRef, useState } from "react";
import { imageUrl, type FileEntry } from "../ipc";
import { isAbort, load, peek } from "../lib/imageCache";

export type Layer = { url: string; w: number; h: number };
export type ScreenLayer = Layer & { boxW: number; boxH: number };
export type Box = { w: number; h: number };

export type Shown = {
  token: string;
  path: string;
  thumb: Layer | null;
  screen: ScreenLayer | null;
  full: Layer | null;
  failed: boolean;
};

type Patch = Partial<Pick<Shown, "thumb" | "screen" | "full" | "failed">>;

export const tokenOf = (file: FileEntry) => `${file.path}|${file.modifiedMs}`;

const HOLD_OTHER_FILE_MS = 160;
const HOLD_SAME_FILE_MS = 4000;
const RAPID_SCREEN_DELAY_MS = 140;
const RAPID_MS = 200;

function fromCache(file: FileEntry, box: Box | null): Shown | null {
  const thumbUrl = imageUrl(file, "thumb");
  const thumb = peek(thumbUrl);
  const screenUrl = box ? imageUrl(file, "screen", box.w, box.h) : null;
  const screen = screenUrl ? peek(screenUrl) : null;
  if (!thumb && !screen) return null;
  return {
    token: tokenOf(file),
    path: file.path,
    thumb: thumb ? { url: thumbUrl, ...thumb } : null,
    screen: screen && screenUrl && box ? { url: screenUrl, ...screen, boxW: box.w, boxH: box.h } : null,
    full: null,
    failed: false,
  };
}

export function useProgressiveImage(file: FileEntry, box: Box | null, wantFull: boolean): Shown | null {
  const token = tokenOf(file);
  const [shown, setShown] = useState<Shown | null>(() => fromCache(file, box));
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const lastChange = useRef(-Infinity);
  const rapid = useRef(false);
  const prevPath = useRef(file.path);

  if (shown?.token !== token) {
    const cached = fromCache(file, box);
    if (cached) setShown(cached);
  }

  const put = useCallback((tok: string, path: string, patch: Patch) => {
    if (tok !== tokenRef.current) return;
    setShown(prev => {
      if (prev && prev.token === tok) {
        const keys = Object.keys(patch) as (keyof Patch)[];
        return keys.length === 0 ? prev : { ...prev, ...patch };
      }
      return { token: tok, path, thumb: null, screen: null, full: null, failed: false, ...patch };
    });
  }, []);

  const path = file.path;

  useEffect(() => {
    const now = performance.now();
    rapid.current = now - lastChange.current < RAPID_MS;
    lastChange.current = now;
    const samePath = prevPath.current === path;
    prevPath.current = path;

    const ac = new AbortController();
    const url = imageUrl(file, "thumb");
    load(url, ac.signal).then(
      dims => put(token, path, { thumb: { url, ...dims } }),
      () => undefined,
    );
    const hold = window.setTimeout(() => put(token, path, {}), samePath ? HOLD_SAME_FILE_MS : HOLD_OTHER_FILE_MS);
    return () => {
      ac.abort();
      window.clearTimeout(hold);
    };
  }, [token, path, put]);

  const boxW = box?.w ?? 0;
  const boxH = box?.h ?? 0;
  useEffect(() => {
    if (boxW <= 0 || boxH <= 0) return;
    const ac = new AbortController();
    const url = imageUrl(file, "screen", boxW, boxH);
    const run = () =>
      load(url, ac.signal).then(
        dims => put(token, path, { screen: { url, ...dims, boxW, boxH } }),
        (err: unknown) => {
          if (!isAbort(err)) put(token, path, { failed: true });
        },
      );
    let timer = 0;
    if (rapid.current && !peek(url)) timer = window.setTimeout(run, RAPID_SCREEN_DELAY_MS);
    else void run();
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [token, path, boxW, boxH, put]);

  useEffect(() => {
    if (!wantFull) return;
    const ac = new AbortController();
    const url = imageUrl(file, "full");
    load(url, ac.signal).then(
      dims => put(token, path, { full: { url, ...dims } }),
      () => undefined,
    );
    return () => ac.abort();
  }, [token, path, wantFull, put]);

  return shown;
}
