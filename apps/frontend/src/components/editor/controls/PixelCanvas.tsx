import React, { useEffect, useRef } from "react";

type Props = Readonly<{
  /** RGBA bytes of a `width` x `height` picture (keep the array stable: it is painted when it changes). */
  pixels: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  className?: string;
}>;

/**
 * A canvas showing computed pixels (a colour wheel, a band's chip): the panels compute colours with
 * the engine's maths and put them here, so no colour is written as CSS. Decorative: the control
 * around it carries the name.
 */
export function PixelCanvas({ pixels, width, height, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [pixels, width, height]);
  return <canvas ref={canvas} width={width} height={height} className={className} aria-hidden />;
}
