import { useCallback, useRef, useState } from "react";
import { measureContentBox } from "./AutoSizer";
import type { Size } from "./AutoSizer";

/**
 * The size of an element's content box, kept current as it resizes. Unlike Mantine's
 * useElementSize (which reports the border box), this excludes padding, so it matches what an
 * AutoSizer inside the same element hands its children. The returned ref is a callback ref, so it
 * follows an element that mounts after the first render.
 */
export function useContentBoxSize<T extends HTMLElement = HTMLDivElement>() {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;
    const update = () => {
      const next = measureContentBox(element);
      setSize(prev => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(update);
    observer.current.observe(element);
  }, []);

  return { ref, width: size.width, height: size.height };
}
