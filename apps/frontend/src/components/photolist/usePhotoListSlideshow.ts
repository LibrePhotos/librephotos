import type { PigPhoto } from "@librephotos/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoListLightbox } from "./usePhotoListLightbox";

type Options = Readonly<{
  /** The page asks for a slideshow (a public album's `?slideshow=1`). */
  slideshow: boolean;
  /** The list has loaded: its first photo is the one to start from. */
  ready: boolean;
  /** The viewer closed the slideshow: the page drops its flag. */
  onSlideshowClose?: () => void;
}>;

/**
 * A photo list opened as a slideshow (#1457): once the photos are there, the lightbox opens on the
 * first one and plays. It starts once per request: after the viewer closes it, the page drops the
 * flag, and only a new request (Play slideshow) starts it again. Closing a lightbox the viewer
 * opened from the grid does not touch the page's flag.
 */
export function usePhotoListSlideshow(
  idx2hash: PigPhoto[],
  lightbox: PhotoListLightbox,
  { slideshow, ready, onSlideshowClose }: Options
) {
  // The open lightbox is the slideshow (not a photo opened from the grid).
  const [active, setActive] = useState(false);
  const startedRef = useRef(false);
  const first = idx2hash[0];
  const firstId = first && !first.isTemp ? first.id : undefined;
  const { showLightbox, closeLightbox, currentImageIndexRef } = lightbox;

  useEffect(() => {
    if (!slideshow) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current || !ready || firstId === undefined) return;
    startedRef.current = true;
    currentImageIndexRef.current = 0;
    setActive(true);
    showLightbox(firstId, true);
  }, [slideshow, ready, firstId, showLightbox, currentImageIndexRef]);

  const close = useCallback(() => {
    closeLightbox();
    if (!active) return;
    setActive(false);
    onSlideshowClose?.();
  }, [closeLightbox, active, onSlideshowClose]);

  return { active, close };
}

export type PhotoListSlideshow = ReturnType<typeof usePhotoListSlideshow>;
