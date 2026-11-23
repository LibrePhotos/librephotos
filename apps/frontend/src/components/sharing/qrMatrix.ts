import { encode } from "uqr";

const QUIET_ZONE_MODULES = 4;
const FILE_PIXELS_PER_MODULE = 10;

export type QrSquares = Readonly<{ path: string; side: number }>;

export function qrSquares(value: string): QrSquares {
  const { data } = encode(value, { ecc: "M", border: 0 });
  const path = data
    .flatMap((row, y) =>
      row.map((dark, x) => (dark ? `M${x + QUIET_ZONE_MODULES} ${y + QUIET_ZONE_MODULES}h1v1h-1z` : ""))
    )
    .join("");
  return { path, side: data.length + QUIET_ZONE_MODULES * 2 };
}

export function qrSvgDataUrl({ path, side }: QrSquares): string {
  const pixels = side * FILE_PIXELS_PER_MODULE;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${side}" fill="white"/><path d="${path}" fill="black"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
