import React, { useMemo } from "react";
import { encode } from "uqr";

const QUIET_ZONE = 2;

type Props = Readonly<{
  value: string;
  size?: number;
}>;

export function QrCode({ value, size = 132 }: Props) {
  const { path, side } = useMemo(() => {
    const matrix = encode(value, { ecc: "M" }).data;
    const d = matrix
      .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z` : "")))
      .join("");
    return { path: d, side: matrix.length + QUIET_ZONE * 2 };
  }, [value]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${side} ${side}`} role="img" aria-label="QR code">
      <rect width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
