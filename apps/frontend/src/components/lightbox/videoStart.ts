import { createContext } from "react";
import type { LightboxItem } from "./lightbox.types";

/**
 * Opening a video at the moment a face appears (#2762). A face found in a later frame of a video
 * carries the second of that frame (`video_time`, #2761); the player starts a moment before it.
 */

/** Where to start a video, and whose face is there (empty or absent for an unnamed face). */
export type VideoStart = { seconds: number; name?: string };

/** Seconds the player starts early, so the person is not caught half-way through a turn. */
const LEAD_SECONDS = 1;

/** How long the "Started at 0:42" note stays up. */
export const START_NOTICE_MS = 5000;

/** The playhead position for a start at `seconds`: a second early, never before the beginning. */
export function startPosition(seconds: number): number {
  return Math.max(0, seconds - LEAD_SECONDS);
}

/** A start for a face's `video_time`, or undefined for a face on the first frame or a photo. */
export function videoStartOf(seconds: number | null | undefined, name?: string | null): VideoStart | undefined {
  if (seconds === null || seconds === undefined) return undefined;
  return name ? { seconds, name } : { seconds };
}

/**
 * Whether the player can move to another time. A video the backend converts on the fly is a chunked
 * stream with no length, so nothing is seekable and the playhead stays at 0:00.
 */
export function canSeek(video: Pick<HTMLVideoElement, "seekable">): boolean {
  const { seekable } = video;
  return !!seekable && seekable.length > 0 && seekable.end(seekable.length - 1) > 0;
}

/** The start of the lightbox's current item, for the main video (none outside a lightbox). */
export const VideoStartContext = createContext<VideoStart | undefined>(undefined);

/** Where the item `id` of the lightbox's list starts, if it was opened from a face. */
export function videoStartFor(items: LightboxItem[], id: string): VideoStart | undefined {
  return items.find(item => item.id === id)?.videoStart;
}
