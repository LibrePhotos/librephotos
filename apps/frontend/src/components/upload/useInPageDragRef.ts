import { useEffect, useRef } from "react";

/**
 * True while a drag that started on this page runs (a thumbnail, a link):
 * `dragstart` only fires for page content, never for files dragged in from
 * the desktop. Chromium hands an image dragged off a tile over as a file, and
 * the upload drop target must not take it for an upload.
 */
export function useInPageDragRef() {
  const ref = useRef(false);
  useEffect(() => {
    const begin = () => {
      ref.current = true;
    };
    const end = () => {
      ref.current = false;
    };
    document.addEventListener("dragstart", begin);
    document.addEventListener("dragend", end);
    return () => {
      document.removeEventListener("dragstart", begin);
      document.removeEventListener("dragend", end);
    };
  }, []);
  return ref;
}
