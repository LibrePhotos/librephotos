import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useLightboxCommands } from "./lightboxCommands";

/** What the last seek shortcut did: moved by some seconds, or could not move. */
export type SeekHint = { seconds: number } | "unavailable";

/**
 * The lightbox's seek shortcuts for the video in `videoRef`, and what the last one did, shown
 * briefly over the picture. A keyboard-driven seek never raises the native control bar, so without
 * the hint the key produces no visible acknowledgement at all. A new `url` clears it.
 */
export function useSeekShortcut(videoRef: React.RefObject<HTMLVideoElement | null>, url: string): SeekHint | null {
  const commands = useLightboxCommands();
  const [seekHint, setSeekHint] = useState<SeekHint | null>(null);
  const seekHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSeekHint(null);
  }, [url]);

  useEffect(() => {
    const showHint = (hint: { seconds: number } | "unavailable") => {
      setSeekHint(hint);
      if (seekHintTimerRef.current) clearTimeout(seekHintTimerRef.current);
      seekHintTimerRef.current = setTimeout(() => setSeekHint(null), 900);
    };

    // The lightbox owns the keyboard, and the `<video>` element only exists here, so the seek
    // arrives as a lightbox command. Only the main slide renders a player, so exactly one
    // subscriber is ever mounted.
    const handleSeek = (seconds: number) => {
      const video = videoRef.current;
      if (!video || !seconds) return;
      // `seekable` is the honest bound, not `duration`. A video the backend is
      // transcoding on the fly is served as a chunked stream with no length and
      // no `Accept-Ranges`, so its duration reads as Infinity and the playhead
      // will not move however far we ask it to. Saying that out loud beats a
      // shortcut that silently does nothing.
      const { seekable } = video;
      if (!seekable || seekable.length === 0) {
        showHint("unavailable");
        return;
      }
      video.currentTime = Math.min(
        Math.max(video.currentTime + seconds, seekable.start(0)),
        seekable.end(seekable.length - 1)
      );
      showHint({ seconds });
    };

    return commands.on("seek", handleSeek);
  }, [commands, videoRef]);

  useEffect(
    () => () => {
      if (seekHintTimerRef.current) clearTimeout(seekHintTimerRef.current);
    },
    []
  );

  return seekHint;
}
