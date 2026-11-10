import { useGesture } from "@use-gesture/react";
import { useKeyedState } from "../../hooks/useKeyedState";

type Zoom = Readonly<{
  /** Set by the zoom toggle (Z, double-click); a pinch sets the scale without it. */
  toggled: boolean;
  scale: number;
  offset: Readonly<{ x: number; y: number }>;
}>;

const UNZOOMED: Zoom = { toggled: false, scale: 1, offset: { x: 0, y: 0 } };
const MAX_SCALE = 4;
/** A pinch that ends below this springs back to 1x. */
const MIN_KEPT_SCALE = 1.5;

/**
 * The lightbox photo's zoom: the zoom toggle (Z, double-click) and pinching set the scale, and a
 * drag then pans the magnified photo. Every new item starts unzoomed, from its first render: a zoom
 * left over from the last photo would keep swiping off, and a video next has no zoom button to undo it.
 */
export function useLightboxZoom(mainSrc: string) {
  const [zoom, setZoom] = useKeyedState(mainSrc, () => UNZOOMED);
  const { toggled: isZoomed, scale, offset } = zoom;

  const toggleZoom = () =>
    setZoom(current => (current.toggled ? UNZOOMED : { toggled: true, scale: 2, offset: { x: 0, y: 0 } }));

  // Pinching sets the scale without the zoom toggle, and either way a drag
  // then pans the photo instead of swiping to the next one.
  const isMagnified = isZoomed || scale > 1;

  const bind = useGesture(
    {
      // The gesture's offset is the scale itself: it starts from the photo's scale (`from`).
      onPinch: state => setZoom(current => ({ ...current, scale: state.offset[0] })),
      onPinchEnd: () => setZoom(current => (current.scale < MIN_KEPT_SCALE ? { ...current, scale: 1 } : current)),
      onDrag: state => {
        if (isMagnified) setZoom(current => ({ ...current, offset: { x: state.offset[0], y: state.offset[1] } }));
      },
    },
    { pinch: { from: () => [scale, 0], scaleBounds: { min: 1, max: MAX_SCALE } } }
  );

  return { isZoomed, scale, offset, toggleZoom, isMagnified, bind };
}
