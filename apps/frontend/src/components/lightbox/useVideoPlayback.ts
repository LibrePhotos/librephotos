import { useCallback } from "react";
import { useKeyedState } from "../../hooks/useKeyedState";
import { initialPlayback, nextPlayback, type VideoPlaybackEvent } from "./videoPlayback";

/** The player's state for the video at `url`; a new url starts loading in the render that shows it. */
export function useVideoPlayback(url: string) {
  const [playback, update] = useKeyedState(url, initialPlayback);
  const dispatch = useCallback((event: VideoPlaybackEvent) => update(state => nextPlayback(state, event)), [update]);
  return [playback, dispatch] as const;
}
