import { useCallback } from "react";
import { useKeyedState } from "../../hooks/useKeyedState";
import { isMagnifiedView, TOGGLE_SCALE, UNZOOMED, type LightboxView } from "./lightboxView";

export function useLightboxZoom(mainSrc: string) {
  const [view, setView] = useKeyedState<LightboxView>(mainSrc, () => UNZOOMED);
  const isMagnified = isMagnifiedView(view);

  const toggleZoom = useCallback(
    () => setView(current => (isMagnifiedView(current) ? UNZOOMED : { scale: TOGGLE_SCALE, x: 0, y: 0 })),
    [setView]
  );

  return { view, setView, scale: view.scale, isZoomed: isMagnified, isMagnified, toggleZoom };
}

export type LightboxZoom = ReturnType<typeof useLightboxZoom>;
