import { useGesture } from "@use-gesture/react";
import { useEffect, useState } from "react";

/**
 * The lightbox photo's zoom: the zoom toggle (Z, double-click) and pinching set the scale, and a
 * drag then pans the magnified photo. Every new item starts unzoomed: a zoom left over from the
 * last photo would keep swiping off, and a video next has no zoom button to undo it.
 */
export function useLightboxZoom(mainSrc: string) {
  const [isZoomed, setIsZoomed] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // For dragging the image

  useEffect(() => {
    setIsZoomed(false);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [mainSrc]);

  const toggleZoom = () => {
    const newZoomState = !isZoomed;
    setIsZoomed(newZoomState);
    setScale(newZoomState ? 2 : 1);
    setOffset({ x: 0, y: 0 });
  };

  // Pinching sets the scale without the zoom toggle, and either way a drag
  // then pans the photo instead of swiping to the next one.
  const isMagnified = isZoomed || scale > 1;

  const bind = useGesture({
    onPinch: state => {
      setScale(Math.max(1, Math.min(scale * state.offset[0], 4)));
    },
    onPinchEnd: () => {
      if (scale < 1.5) {
        setScale(1);
      } else {
        setScale(Math.min(scale, 4));
      }
    },
    onDrag: state => {
      if (isMagnified) {
        setOffset({
          x: state.offset[0],
          y: state.offset[1],
        });
      }
    },
  });

  return { isZoomed, scale, offset, toggleZoom, isMagnified, bind };
}
