import { useCallback, useEffect, useState } from "react";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks";

type Args = {
  /** Start playing as a slideshow instead of waiting for the "s" hotkey. */
  startSlideshow?: boolean;
  /** A public page: no user settings to read the interval from. */
  isPublic: boolean;
  type: string;
  mainSrc: string;
  nextSrc: string | null;
  onMoveNextRequest: () => void;
};

/** How often the progress ring moves, in milliseconds. */
const PROGRESS_STEP_MS = 50;

/**
 * The lightbox's slideshow: on or off, the seconds per photo (the user's setting until changed
 * here), and the progress ring. A photo moves on when its time is up, a video when it has ended;
 * past the last item the slideshow stops.
 */
export function useSlideshow({ startSlideshow, isPublic, type, mainSrc, nextSrc, onMoveNextRequest }: Args) {
  const [isSlideshowActive, setIsSlideshowActive] = useState(startSlideshow ?? false);
  const [localSlideshowInterval, setSlideshowInterval] = useState<number | null>(null);
  const [slideshowProgress, setSlideshowProgress] = useState(0);

  // The user's default interval (skipped on public pages)
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery(isPublic);
  const slideshowInterval = localSlideshowInterval ?? userSelfDetails?.slideshow_interval ?? 5;

  useEffect(() => {
    setSlideshowProgress(0);
  }, [mainSrc]);

  // Slideshow timer and progress for images
  useEffect(() => {
    if (!isSlideshowActive || type === "video" || type === "embedded") {
      setSlideshowProgress(0);
      return;
    }

    const totalDuration = slideshowInterval * 1000;
    let elapsed = 0;

    const progressTimer = setInterval(() => {
      elapsed += PROGRESS_STEP_MS;
      setSlideshowProgress(Math.min((elapsed / totalDuration) * 100, 100));

      if (elapsed >= totalDuration) {
        clearInterval(progressTimer);
        if (nextSrc) {
          onMoveNextRequest();
        } else {
          // Stop slideshow if no more images
          setIsSlideshowActive(false);
        }
      }
    }, PROGRESS_STEP_MS);

    return () => clearInterval(progressTimer);
  }, [isSlideshowActive, type, mainSrc, slideshowInterval, nextSrc, onMoveNextRequest]);

  // Handle video ended - advance to next if slideshow is active
  const handleVideoEnded = useCallback(() => {
    if (isSlideshowActive && nextSrc) {
      onMoveNextRequest();
    } else if (isSlideshowActive && !nextSrc) {
      // Stop slideshow if no more items
      setIsSlideshowActive(false);
    }
  }, [isSlideshowActive, nextSrc, onMoveNextRequest]);

  const toggleSlideshow = useCallback(() => {
    setIsSlideshowActive(prev => !prev);
  }, []);

  return {
    isSlideshowActive,
    toggleSlideshow,
    slideshowInterval,
    setSlideshowInterval,
    slideshowProgress,
    handleVideoEnded,
  };
}
