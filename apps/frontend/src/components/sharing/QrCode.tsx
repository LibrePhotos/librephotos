import React from "react";
import classes from "./QrCode.module.css";
import type { QrSquares } from "./qrMatrix";

type Props = Readonly<{
  squares: QrSquares;
  label: string;
  size: number;
}>;

export function QrCode({ squares: { path, side }, label, size }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <rect className={classes.ground} width={side} height={side} />
      <path className={classes.modules} d={path} />
    </svg>
  );
}
