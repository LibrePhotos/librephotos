import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLightboxCommands } from "./lightboxCommands";
import type { VideoStart } from "./videoStart";
import { canSeek, START_NOTICE_MS, startPosition } from "./videoStart";

/** What the note over the video says: it started at a face, or it cannot move there. */
export type VideoStartNotice = VideoStart & { kind: "started" | "unseekable" };

type VideoStartControls = {
  notice: VideoStartNotice | null;
  /** For the `<video>`'s onLoadedMetadata: the first moment the playhead can move. */
  onLoadedMetadata: () => void;
  playFromStart: () => void;
};

// HTMLMediaElement.HAVE_METADATA: the duration and what is seekable are known.
const HAVE_METADATA = 1;

/**
 * Starts the video at `start` once its metadata has loaded, and at whatever moment a face's time
 * button asks for later (the `seekTo` lightbox command). Either way a note says so for a few
 * seconds and offers to play from the start; a stream that cannot seek gets a note saying that
 * instead of silently playing from 0:00. `src` restarts it: a new video, or the converted copy.
 */
export function useVideoStart(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  start: VideoStart | undefined,
  src: string
): VideoStartControls {
  const commands = useLightboxCommands();
  const [notice, setNotice] = useState<VideoStartNotice | null>(null);
  // A start waiting for the metadata.
  const pendingRef = useRef<VideoStart | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startSeconds = start?.seconds;
  const startName = start?.name;

  const show = useCallback((next: VideoStartNotice | null) => {
    setNotice(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (next) timerRef.current = setTimeout(() => setNotice(null), START_NOTICE_MS);
  }, []);

  const seek = useCallback(
    (target: VideoStart) => {
      const video = videoRef.current;
      if (!video || video.readyState < HAVE_METADATA) {
        pendingRef.current = target;
        return;
      }
      if (!canSeek(video)) {
        show({ ...target, kind: "unseekable" });
        return;
      }
      video.currentTime = startPosition(target.seconds);
      show({ ...target, kind: "started" });
    },
    [videoRef, show]
  );

  useEffect(() => {
    pendingRef.current = startSeconds === undefined ? null : { seconds: startSeconds, name: startName };
    show(null);
  }, [src, startSeconds, startName, show]);

  useEffect(() => commands.on("seekTo", (seconds, name) => seek({ seconds, name })), [commands, seek]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const onLoadedMetadata = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) seek(pending);
  }, [seek]);

  const playFromStart = useCallback(() => {
    if (videoRef.current) videoRef.current.currentTime = 0;
    show(null);
  }, [videoRef, show]);

  return { notice, onLoadedMetadata, playFromStart };
}
