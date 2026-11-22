import { useEffect, useRef, type RefObject } from "react";
import { trackViewerGestures, type ViewerGestureHandlers } from "./viewerGestures";

type Attached = Readonly<{ element: HTMLElement; dispose: () => void }>;

export function useViewerGestures(
  target: RefObject<HTMLElement | null>,
  handlers: ViewerGestureHandlers,
  enabled = true
): void {
  const latest = useRef(handlers);
  const attached = useRef<Attached | null>(null);
  useEffect(() => {
    latest.current = handlers;
    const element = enabled ? target.current : null;
    if (attached.current?.element === element) return;
    attached.current?.dispose();
    attached.current = element ? { element, dispose: trackViewerGestures(element, () => latest.current) } : null;
  });
  useEffect(
    () => () => {
      attached.current?.dispose();
      attached.current = null;
    },
    []
  );
}
