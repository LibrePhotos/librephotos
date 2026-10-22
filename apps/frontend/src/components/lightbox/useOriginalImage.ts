import { useCallback, useEffect, useRef, useState } from "react";
import type { PixelSize } from "./originalZoom";

export type OriginalImageStatus = "idle" | "loading" | "loaded" | "failed";

export type OriginalImage = {
  status: OriginalImageStatus;
  /** The loaded original's natural size; null until it has loaded. */
  size: PixelSize | null;
  /** Load it again after a failure. */
  retry: () => void;
};

type Result = { url: string; status: "loading" | "loaded" | "failed"; size: PixelSize | null };
type Inflight = { url: string; attempt: number; image: HTMLImageElement };

function abandon(inflight: Inflight | null) {
  if (!inflight) return;
  inflight.image.onload = null;
  inflight.image.onerror = null;
  // An empty src stops the browser fetching the rest of a large file.
  inflight.image.removeAttribute("src");
}

/**
 * Preload `url` in the background once `wanted` turns true, so the <img> can
 * swap to it when it is ready and keep the thumbnail until then (#2742).
 *
 * A load that has started runs to the end even if `wanted` turns false again
 * (zooming out), and once loaded it stays loaded: the lightbox keeps the
 * original until the slide changes. A different `url` (another photo, or the
 * same one after a rotation) starts over; `null` means there is nothing to load.
 */
export function useOriginalImage(url: string | null, wanted: boolean): OriginalImage {
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const inflight = useRef<Inflight | null>(null);

  useEffect(() => {
    if (!wanted || url === null) return;
    const current = inflight.current;
    if (current && current.url === url && current.attempt === attempt) return;
    abandon(current);
    const image = new Image();
    inflight.current = { url, attempt, image };
    setResult({ url, status: "loading", size: null });
    image.onload = () => {
      if (inflight.current?.image !== image) return;
      setResult({ url, status: "loaded", size: { width: image.naturalWidth, height: image.naturalHeight } });
    };
    image.onerror = () => {
      if (inflight.current?.image !== image) return;
      setResult({ url, status: "failed", size: null });
    };
    image.src = url;
  }, [url, wanted, attempt]);

  useEffect(
    () => () => {
      abandon(inflight.current);
      inflight.current = null;
    },
    []
  );

  const retry = useCallback(() => setAttempt(previous => previous + 1), []);
  const own = result !== null && result.url === url ? result : null;
  return { status: own?.status ?? "idle", size: own?.size ?? null, retry };
}
