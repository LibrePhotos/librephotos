import { chunk } from "lodash-es";
import type { GridRows } from "./hooks/useVirtualizedGrid";
import { isPersonCell } from "./hooks/useVirtualizedGrid";

/*
 * The faces grid: columns like `repeat(auto-fill, minmax(220px, 1fr))` with a 12px gap, laid out
 * here so the grid still virtualizes by row. A group of up to four faces is a borderless tile in
 * one column: its faces two by two, then its name and count. A bigger group is the same tile while
 * folded, and a section the width of the grid while open: a header row, then rows of its faces,
 * two to a column, so every face on the page lines up with the tiles' faces.
 */

/** The faces a tile shows; a group with more can be opened into a section. */
export const TILE_FACES = 4;
/** Faces side by side in one column. */
const FACES_PER_COLUMN = 2;
/** Between two faces, across and down. */
const FACE_GAP = 4;
/** Between two columns. */
const COLUMN_GAP = 12;
/** Under a row of tiles, and under a section's last faces. */
const ROW_GAP = 20;
/** The narrowest column: two 96px faces and more. A phone has two columns of smaller faces. */
const MIN_COLUMN = 220;
const MIN_COLUMN_PHONE = 150;
/** Faces grow with their column up to here, so a wide column does not show giant crops. */
const MAX_FACE = 128;
const MIN_FACE = 48;
/** Under a tile's faces: 8px, its name line (with its buttons) and its count. */
const TILE_CAPTION = 8 + 24 + 16;
/** A section's header line and the space under it. */
const SECTION_HEADER = 32 + 12;
/** Room for a scrollbar that takes width (Windows): the rows stop short of it. Not on a phone,
 * where scrollbars overlay the content and the room would only widen the right margin. */
const SCROLLBAR_ROOM = 16;
const PHONE_WIDTH = 576;

/** The grid's columns and the size of every face in it, for one width. */
export type FaceGridLayout = Readonly<{ columns: number; faceSize: number }>;

/** The width the rows are laid out in: the grid's, less a scrollbar's. */
export const layoutWidthOf = (gridWidth: number): number =>
  gridWidth < PHONE_WIDTH ? gridWidth : gridWidth - SCROLLBAR_ROOM;

/** As many columns as fit at their narrowest; the faces fill their column two by two. */
export function faceGridLayout(layoutWidth: number): FaceGridLayout {
  const minColumn = layoutWidth < PHONE_WIDTH ? MIN_COLUMN_PHONE : MIN_COLUMN;
  const columns = Math.max(1, Math.floor((layoutWidth + COLUMN_GAP) / (minColumn + COLUMN_GAP)));
  const columnWidth = (layoutWidth - (columns - 1) * COLUMN_GAP) / columns;
  const fill = Math.floor((columnWidth - (FACES_PER_COLUMN - 1) * FACE_GAP) / FACES_PER_COLUMN);
  return { columns, faceSize: Math.max(MIN_FACE, Math.min(MAX_FACE, fill)) };
}

/** Whether a group can be opened into a section: it has more faces than a tile shows. */
export const isFoldable = (group: { faces: readonly unknown[] }): boolean => group.faces.length > TILE_FACES;

/**
 * What a grid row is. `tiles`: tiles side by side, each a group and the faces it shows. `header`:
 * an open group's header, `faces` a row of its faces and `lastFaces` the last one.
 */
export type FaceRowKind = "tiles" | "header" | "faces" | "lastFaces";

type Group = { id: number; faces: readonly unknown[] };

/**
 * The grid's rows for a tab's groups, in their order. A tiles row lists each of its groups followed
 * by the faces its tile shows; an open group is a row holding just the group, then rows of its
 * faces. A folded group's other faces are left out, so the row count, the scrubber and the page
 * loader shrink with it.
 */
export function buildFaceGridRows<Person extends Group>(
  groups: readonly Person[],
  layout: FaceGridLayout,
  collapsed: ReadonlySet<number>
): Array<Array<Person | Person["faces"][number]>> {
  const rows: Array<Array<Person | Person["faces"][number]>> = [];
  let tiles: Array<Person | Person["faces"][number]> = [];
  let tileCount = 0;
  const flushTiles = () => {
    if (tiles.length > 0) rows.push(tiles);
    tiles = [];
    tileCount = 0;
  };

  for (const group of groups) {
    if (isFoldable(group) && !collapsed.has(group.id)) {
      flushTiles();
      rows.push([group], ...chunk(group.faces, layout.columns * FACES_PER_COLUMN));
      continue;
    }
    tiles.push(group, ...group.faces.slice(0, TILE_FACES));
    tileCount += 1;
    if (tileCount === layout.columns) flushTiles();
  }
  flushTiles();
  return rows;
}

const isFaceRow = (row: GridRows[number] | undefined): boolean => {
  const first = row?.[0];
  return first !== undefined && !isPersonCell(first);
};

/** The kind of each row, read off the rows themselves (see FaceRowKind). */
export function faceRowKinds(rows: GridRows): FaceRowKind[] {
  return rows.map((row, index): FaceRowKind => {
    const first = row[0];
    const nextIsFaces = isFaceRow(rows[index + 1]);
    if (first === undefined || !isPersonCell(first)) return nextIsFaces ? "faces" : "lastFaces";
    return row.length === 1 && nextIsFaces ? "header" : "tiles";
  });
}

/** The lines of faces of a tiles row's tallest tile. */
function tileLines(row: GridRows[number]): number {
  let lines = 0;
  let faces = 0;
  for (const cell of [...row, undefined]) {
    if (cell === undefined || isPersonCell(cell)) {
      lines = Math.max(lines, Math.ceil(Math.min(faces, TILE_FACES) / FACES_PER_COLUMN));
      faces = 0;
    } else {
      faces += 1;
    }
  }
  return lines;
}

/** How tall `lines` lines of faces are. */
const facesHeight = (lines: number, faceSize: number): number =>
  lines > 0 ? lines * faceSize + (lines - 1) * FACE_GAP : 0;

/** The heights of the grid's rows, in order. */
export function faceRowHeights(rows: GridRows, layout: FaceGridLayout): number[] {
  return faceRowKinds(rows).map((kind, index) => {
    switch (kind) {
      case "tiles":
        return facesHeight(tileLines(rows[index] ?? []), layout.faceSize) + TILE_CAPTION + ROW_GAP;
      case "header":
        return SECTION_HEADER;
      case "faces":
        return layout.faceSize + FACE_GAP;
      case "lastFaces":
        return layout.faceSize + ROW_GAP;
    }
  });
}
