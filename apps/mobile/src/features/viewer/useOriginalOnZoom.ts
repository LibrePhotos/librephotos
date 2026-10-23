import { useCallback, useState } from "react";
import type { ImageLoadEventData, ImageProgressEventData } from "expo-image";
import type { PixelSize } from "./useImagePixelSize";

/** How the zoom original of the active slide is coming along (expo-image's events). */
export type OriginalLoad = {
  status: "loading" | "loaded" | "failed";
  /** Bytes so far and in all; total is 0 until the server said. */
  loaded: number;
  total: number;
  /** The original's size once it has loaded. */
  size: PixelSize | null;
};

type SlideZoom = {
  key: string;
  /** Zoomed in right now: the chip shows only then. */
  zoomed: boolean;
  /** Zoomed in at least once since the slide became active: the original stays from then on. */
  zoomedOnce: boolean;
  load: OriginalLoad;
  /** Bumped by Try again; part of the image's React key, so it loads again. */
  attempt: number;
};

const LOADING: OriginalLoad = { status: "loading", loaded: 0, total: 0, size: null };

function fresh(key: string): SlideZoom {
  return { key, zoomed: false, zoomedOnce: false, load: LOADING, attempt: 0 };
}

/**
 * Zoom state and original-loading progress of the active slide (#2743). It
 * belongs to one slide: when another slide becomes active, everything starts
 * over, so swiping on goes back to thumbnails. The callbacks take the slide's
 * key, so an event from a slide that is no longer active cannot leak into the
 * next one.
 */
export function useOriginalOnZoom(activeKey: string | undefined) {
  const [state, setState] = useState<SlideZoom | null>(null);
  const update = useCallback((key: string, change: (zoom: SlideZoom) => SlideZoom) => {
    setState((previous) => change(previous?.key === key ? previous : fresh(key)));
  }, []);

  const onZoomChange = useCallback(
    (key: string, zoomed: boolean) =>
      update(key, (zoom) => ({ ...zoom, zoomed, zoomedOnce: zoom.zoomedOnce || zoomed })),
    [update]
  );
  const onProgress = useCallback(
    (key: string, event: ImageProgressEventData) =>
      update(key, (zoom) => ({ ...zoom, load: { ...LOADING, loaded: event.loaded, total: event.total } })),
    [update]
  );
  const onLoad = useCallback(
    (key: string, event: ImageLoadEventData) =>
      update(key, (zoom) => ({
        ...zoom,
        load: { ...zoom.load, status: "loaded", size: { width: event.source.width, height: event.source.height } },
      })),
    [update]
  );
  const onError = useCallback(
    (key: string) => update(key, (zoom) => ({ ...zoom, load: { ...zoom.load, status: "failed" } })),
    [update]
  );
  const retry = useCallback(
    (key: string) => update(key, (zoom) => ({ ...zoom, load: LOADING, attempt: zoom.attempt + 1 })),
    [update]
  );

  const own = state !== null && state.key === activeKey ? state : fresh(activeKey ?? "");
  return { ...own, onZoomChange, onProgress, onLoad, onError, retry };
}
