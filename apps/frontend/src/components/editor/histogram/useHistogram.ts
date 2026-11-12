/**
 * The histogram of the preview, read from the renderer after the frames settle: a readback waits
 * for the GPU, so it is taken at most a few times a second and only once the frames pause for a
 * moment, never per frame. Every panel that shows it (the histogram, the tone curve) shares one
 * reading per preview; nothing is read while no open panel wants it.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useEditor, type PreviewHandle } from "../EditorContext";
import type { Histogram } from "../engine/histogram";

/** Quiet time after a frame before the histogram is read. */
const SETTLE_MS = 120;
/** The shortest time between two readbacks. */
const MIN_INTERVAL_MS = 300;

type Feed = {
  value: Histogram | null;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  lastRead: number;
  stopFrames: (() => void) | null;
};

const feeds = new WeakMap<PreviewHandle, Feed>();

function feedOf(preview: PreviewHandle): Feed {
  const existing = feeds.get(preview);
  if (existing) return existing;
  const created: Feed = { value: null, listeners: new Set(), timer: null, lastRead: 0, stopFrames: null };
  feeds.set(preview, created);
  return created;
}

function read(preview: PreviewHandle, feed: Feed): void {
  feed.timer = null;
  feed.lastRead = performance.now();
  const histogram = preview.renderer()?.histogram() ?? null;
  if (histogram === null) return;
  feed.value = histogram;
  feed.listeners.forEach(listener => listener());
}

/** Read once the frames pause, and not sooner than MIN_INTERVAL_MS after the last reading. */
function schedule(preview: PreviewHandle, feed: Feed): void {
  if (feed.timer !== null) clearTimeout(feed.timer);
  const sinceLast = performance.now() - feed.lastRead;
  feed.timer = setTimeout(() => read(preview, feed), Math.max(SETTLE_MS, MIN_INTERVAL_MS - sinceLast));
}

function subscribe(preview: PreviewHandle, listener: () => void): () => void {
  const feed = feedOf(preview);
  feed.listeners.add(listener);
  if (feed.stopFrames === null) {
    feed.stopFrames = preview.onFrame(() => schedule(preview, feed));
    schedule(preview, feed);
  }
  return () => {
    feed.listeners.delete(listener);
    if (feed.listeners.size > 0) return;
    feed.stopFrames?.();
    feed.stopFrames = null;
    if (feed.timer !== null) clearTimeout(feed.timer);
    feed.timer = null;
  };
}

const idle = () => () => {};

/** The preview's histogram while `enabled` (its section is open); null until the first reading. */
export function useHistogram(enabled: boolean): Histogram | null {
  const { preview } = useEditor();
  const listen = useCallback((listener: () => void) => subscribe(preview, listener), [preview]);
  return useSyncExternalStore(
    enabled ? listen : idle,
    () => (enabled ? (feeds.get(preview)?.value ?? null) : null),
    () => null
  );
}
