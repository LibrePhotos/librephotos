import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { useKeyedState } from "../../hooks/useKeyedState";

type Args = {
  /** Start playing as a slideshow instead of waiting for the "s" hotkey. */
  startSlideshow?: boolean;
  /** A public page: no user settings to read the interval from. */
  isPublic: boolean;
  type: string;
  mainSrc: string;
  nextSrc: string | null;
  onMoveNextRequest: () => void;
  /**
   * The viewer is busy with the photo (zoomed, in the 360° view, a face being drawn, live text,
   * an unsaved edit): the slideshow waits, and goes on from where it was once this is false.
   */
  held?: boolean;
};

/** How often the progress ring moves, in milliseconds. */
const PROGRESS_STEP_MS = 50;

/** What a video in the slideshow has done; a photo stays "showing". */
type ItemProgress = "showing" | "ended" | "unplayable";

/**
 * The lightbox's slideshow: on or off, the seconds per photo (the user's setting until changed
 * here), and the progress ring. A photo moves on when its time is up, a video when it has ended,
 * and a video that cannot play after a photo's time; past the last item the slideshow stops.
 */
export function useSlideshow({ startSlideshow, isPublic, type, mainSrc, nextSrc, onMoveNextRequest, held }: Args) {
  const [isSlideshowActive, setIsSlideshowActive] = useState(startSlideshow ?? false);
  const [localSlideshowInterval, setSlideshowInterval] = useState<number | null>(null);
  const [progress, setProgress] = useKeyedState(mainSrc, () => 0);
  const [item, setItem] = useKeyedState<ItemProgress>(mainSrc, () => "showing");
  // The time already shown, kept while the slideshow is held.
  const elapsed = useRef({ item: mainSrc, ms: 0 });

  // The user's default interval (skipped on public pages)
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery(isPublic);
  const slideshowInterval = localSlideshowInterval ?? userSelfDetails?.slideshow_interval ?? 5;

  // Read when the time is up, so a new list (or its step function) does not restart the timer.
  const advance = useEffectEvent(() => {
    if (nextSrc) onMoveNextRequest();
    else setIsSlideshowActive(false);
  });

  const running = isSlideshowActive && !held;
  const timed = type === "photo" || item === "unplayable";
  useEffect(() => {
    if (!running || !timed) return;
    if (elapsed.current.item !== mainSrc) elapsed.current = { item: mainSrc, ms: 0 };
    const totalDuration = slideshowInterval * 1000;
    const progressTimer = setInterval(() => {
      const ms = elapsed.current.ms + PROGRESS_STEP_MS;
      elapsed.current = { item: mainSrc, ms };
      setProgress(() => Math.min((ms / totalDuration) * 100, 100));
      if (ms >= totalDuration) {
        clearInterval(progressTimer);
        advance();
      }
    }, PROGRESS_STEP_MS);
    return () => clearInterval(progressTimer);
  }, [running, timed, mainSrc, slideshowInterval, setProgress]);

  useEffect(() => {
    if (running && item === "ended") advance();
  }, [running, item]);

  const handleVideoEnded = useCallback(() => {
    if (isSlideshowActive) setItem(() => "ended");
  }, [isSlideshowActive, setItem]);

  const handleVideoUnplayable = useCallback(() => setItem(() => "unplayable"), [setItem]);

  const toggleSlideshow = useCallback(() => {
    elapsed.current = { item: "", ms: 0 };
    setProgress(() => 0);
    setIsSlideshowActive(prev => !prev);
  }, [setProgress]);

  return {
    isSlideshowActive,
    toggleSlideshow,
    slideshowInterval,
    setSlideshowInterval,
    slideshowProgress: isSlideshowActive ? progress : 0,
    handleVideoEnded,
    handleVideoUnplayable,
  };
}
