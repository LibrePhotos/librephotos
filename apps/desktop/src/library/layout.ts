/**
 * The timeline's justified layout, after the web app's react-pig (computeLayoutGroups.ts and
 * getMinAspectRatio.ts): day groups under a date header, each a run of justified rows at the
 * target row height; a day short enough to fit on one line shares that line with the days next to
 * it (each under its own header), as in Immich and Google Photos.
 *
 * Pure arithmetic over aspect ratios that are already known (the library rows carry width and
 * height from the file header; 3:2 when missing): no DOM reads, so it never forces a layout. The
 * result is a flat list of blocks sorted by `top`, which the grid binary-searches to render only
 * what is in view.
 */

/** Space between tiles (web gridGap). */
export const GAP = 4;
/** A day header's line plus the ~10 px down to its photos (web headerSize "normal", desktop). */
export const DAY_HEADER = 32;
/** Space between two days (web groupGap for "normal"). */
const GROUP_GAP = 28;
/** Space between two short days sharing a line, and the least width such a day takes. */
const INLINE_GAP = 24;
const INLINE_MIN_WIDTH = 170;
/** A section heading ("On this computer"): an 18px title over a dimmed count. */
export const SECTION_HEADER = 64;
const SECTION_GAP = 12;
/** Aspect ratio used when a file's size is not known yet. */
export const FALLBACK_ASPECT = 3 / 2;

/** Rows of about 130 px on a phone and 170-230 px on a desktop (web getMinAspectRatio). */
export function minAspectRatio(width: number): number {
  if (width <= 480) return 2.8;
  if (width <= 800) return 4;
  if (width <= 1280) return 5.9;
  if (width <= 1920) return 6.2;
  return 7.5;
}

/** Which list a tile comes from: 0 the local files, 1 the server-only hits. */
export type Source = 0 | 1;

export type Part =
  | { kind: "section"; title: string; count: number; id: string }
  | { kind: "group"; label: string; count: number; source: Source; start: number; end: number };

export type LaidTile = { source: Source; index: number; left: number; width: number };

export type Block =
  | { kind: "section"; top: number; height: number; title: string; count: number; id: string }
  | { kind: "header"; top: number; height: number; left: number; width: number; label: string; count: number }
  | { kind: "row"; top: number; height: number; tiles: LaidTile[] };

export type Layout = { blocks: Block[]; height: number };

/**
 * Lays out `parts` in `width` px. `aspect(source, index)` is a tile's width / height. Pixel
 * positions are rounded so tile edges land on whole CSS pixels and gaps stay even.
 */
export function justify(parts: Part[], width: number, aspect: (source: Source, index: number) => number): Layout {
  const blocks: Block[] = [];
  if (width <= 0) return { blocks, height: 0 };
  const minRatio = minAspectRatio(width);
  const target = Math.round(width / minRatio);
  let top = 0;

  // The open line of short days: their headers and tiles, and its right edge so far.
  let lineHeaders: Block[] = [];
  let lineTiles: LaidTile[] = [];
  let lineRight: number | null = null;
  const closeLine = () => {
    if (lineRight === null) return;
    for (const h of lineHeaders) blocks.push(h);
    blocks.push({ kind: "row", top: top + DAY_HEADER, height: target, tiles: lineTiles });
    top += DAY_HEADER + target + GAP + GROUP_GAP;
    lineHeaders = [];
    lineTiles = [];
    lineRight = null;
  };

  for (const part of parts) {
    if (part.kind === "section") {
      closeLine();
      blocks.push({ kind: "section", top, height: SECTION_HEADER, title: part.title, count: part.count, id: part.id });
      top += SECTION_HEADER + SECTION_GAP;
      continue;
    }
    const { source, start, end } = part;
    if (end <= start) continue;
    let ratioSum = 0;
    for (let i = start; i < end; i++) ratioSum += aspect(source, i);
    const shortWidth = ratioSum * target + GAP * (end - start - 1);

    if (shortWidth <= width) {
      // A short day: one row at the target height, on the open line when it still fits.
      const w = Math.max(shortWidth, INLINE_MIN_WIDTH);
      if (lineRight !== null && lineRight + INLINE_GAP + w > width) closeLine();
      const left: number = lineRight === null ? 0 : lineRight + INLINE_GAP;
      lineHeaders.push({
        kind: "header",
        top,
        height: DAY_HEADER,
        left,
        width: Math.min(w, width - left),
        label: part.label,
        count: part.count,
      });
      let x = left;
      for (let i = start; i < end; i++) {
        const l = Math.round(x);
        const r = Math.round(x + target * aspect(source, i));
        lineTiles.push({ source, index: i, left: l, width: r - l });
        x = r + GAP;
      }
      lineRight = left + w;
      continue;
    }

    // A long day: justified rows across the whole width.
    closeLine();
    blocks.push({ kind: "header", top, height: DAY_HEADER, left: 0, width, label: part.label, count: part.count });
    let y = top + DAY_HEADER;
    let rowStart = start;
    let rowRatio = 0;
    for (let i = start; i < end; i++) {
      rowRatio += aspect(source, i);
      if (rowRatio < minRatio && i + 1 < end) continue;
      const n = i + 1 - rowStart;
      const available = width - GAP * (n - 1);
      // A last row too short to fill the width keeps the target height instead of growing.
      const full = rowRatio >= minRatio;
      const h = Math.round(available / Math.max(rowRatio, minRatio));
      const tiles: LaidTile[] = [];
      let x = 0;
      for (let j = rowStart; j <= i; j++) {
        const l = Math.round(x);
        // The last tile of a full row ends exactly at the right edge.
        const r = full && j === i ? width : Math.round(x + h * aspect(source, j));
        tiles.push({ source, index: j, left: l, width: r - l });
        x = r + GAP;
      }
      blocks.push({ kind: "row", top: y, height: h, tiles });
      y += h + GAP;
      rowStart = i + 1;
      rowRatio = 0;
    }
    top = y + GROUP_GAP;
  }
  closeLine();
  return { blocks, height: Math.max(0, top - GROUP_GAP - GAP) };
}

/** Index of the first block whose bottom is at or below `y` (blocks are sorted by top). */
export function firstBlockAt(blocks: Block[], y: number): number {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const b = blocks[mid];
    if (!b) break;
    if (b.top + b.height < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
