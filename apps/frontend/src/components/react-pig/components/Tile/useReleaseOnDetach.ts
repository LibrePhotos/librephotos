import { useCallback, useRef } from "react";

/**
 * A ref callback for a `<video>` that releases its media player when React detaches it.
 *
 * Removing a `<video>` frees neither its media player nor the fetch in flight, so scrolling a large
 * video library exhausts the browser's media element budget (#970).
 */
export function useReleaseOnDetach() {
  const node = useRef<HTMLVideoElement | null>(null);
  return useCallback((element: HTMLVideoElement | null) => {
    if (element) {
      node.current = element;
      return;
    }
    const video = node.current;
    node.current = null;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }, []);
}
