import { chunk } from "lodash-es";
import type { GridRows } from "./hooks/useVirtualizedGrid";
import { isPersonCell } from "./hooks/useVirtualizedGrid";

/*
 * The faces grid as rows of cards. Every open group is a card (radius 12, a subtle surface): a small
 * group's card holds its header and one line of faces, and small cards share a row (a "shelf"), so
 * a two-face cluster no longer takes the whole width. A group too wide for one line is a card the
 * width of the grid, cut into a header row and rows of faces so the grid still virtualizes it.
 * Folded people are cells of a row of people (#860).
 */

/** A face's cell: the 72px face and the 4px around it. */
export const FACE_CELL = 80;
/** A folded person's cell: their round cover, name and count. */
export const PERSON_CELL = 112;
/** Room for a scrollbar that takes width (Windows): the rows stop short of it. Not on a phone,
 * where scrollbars overlay the content and the room would only widen the right margin. */
const SCROLLBAR_ROOM = 16;
const PHONE_WIDTH = 576;
/** The card's side padding around its face cells: with the cell's 4px, 12px to a face. */
const CARD_PAD_X = 8;
/** Between two cards, across and down. */
const CARD_GAP = 12;
/** Wide enough for the header: chevron, avatar, name, count and the group's buttons. */
const CARD_MIN_WIDTH = 264;

/** A card's header: 12px padding above the 32px avatar row and 4px (8 with the cell's) to the faces. */
const HEADER_ROW = 48;
/** Under a card's last faces: 8px padding (12 with the cell's) and the gap to the next card. */
const CARD_BOTTOM = 8 + CARD_GAP;

/**
 * What a grid row is. `shelf`: small cards side by side. `header`: the top of a wide card, `faces`
 * its rows of faces and `lastFaces` the last one. `lone`: a group with no faces. `people`: folded
 * people.
 */
export type FaceRowKind = "shelf" | "header" | "lone" | "faces" | "lastFaces" | "people";

const ROW_HEIGHT: Readonly<Record<FaceRowKind, number>> = {
  shelf: HEADER_ROW + FACE_CELL + CARD_BOTTOM,
  header: HEADER_ROW,
  lone: HEADER_ROW + CARD_BOTTOM,
  faces: FACE_CELL,
  lastFaces: FACE_CELL + CARD_BOTTOM,
  people: PERSON_CELL,
};

export const rowHeightOf = (kind: FaceRowKind): number => ROW_HEIGHT[kind];

/** The width the rows are laid out in: the grid's, less a scrollbar's. */
export const layoutWidthOf = (gridWidth: number): number =>
  gridWidth < PHONE_WIDTH ? gridWidth : gridWidth - SCROLLBAR_ROOM;

/** A card holding all of a group's faces in one line. */
export const cardWidthOf = (faceCount: number): number =>
  Math.max(CARD_MIN_WIDTH, 2 * CARD_PAD_X + faceCount * FACE_CELL);

const facesPerLine = (width: number) => Math.max(1, Math.floor((width - 2 * CARD_PAD_X) / FACE_CELL));
const peoplePerRow = (width: number) => Math.max(1, Math.floor(width / PERSON_CELL));

type Group = { id: number; faces: readonly unknown[] };

/**
 * The grid's rows for a tab's groups, in their order. A shelf row lists each of its groups followed
 * by that group's faces; a wide group is a row holding just the group, then rows of its faces. A
 * folded group's faces are left out, so the row count, the scrubber and the page loader shrink with it.
 */
export function buildFaceGridRows<Person extends Group>(
  groups: readonly Person[],
  layoutWidth: number,
  collapsed: ReadonlySet<number>
): Array<Array<Person | Person["faces"][number]>> {
  const rows: Array<Array<Person | Person["faces"][number]>> = [];
  let shelf: Array<Person | Person["faces"][number]> = [];
  let shelfWidth = 0;
  let folded: Person[] = [];
  const flushShelf = () => {
    if (shelf.length > 0) rows.push(shelf);
    shelf = [];
    shelfWidth = 0;
  };
  const flushFolded = () => {
    rows.push(...chunk(folded, peoplePerRow(layoutWidth)));
    folded = [];
  };

  for (const group of groups) {
    if (collapsed.has(group.id)) {
      flushShelf();
      folded.push(group);
      continue;
    }
    flushFolded();
    const width = cardWidthOf(group.faces.length);
    if (group.faces.length > 0 && width <= layoutWidth) {
      if (shelf.length > 0 && shelfWidth + CARD_GAP + width > layoutWidth) flushShelf();
      shelfWidth = shelf.length > 0 ? shelfWidth + CARD_GAP + width : width;
      shelf.push(group, ...group.faces);
      continue;
    }
    flushShelf();
    rows.push([group], ...chunk(group.faces, facesPerLine(layoutWidth)));
  }
  flushShelf();
  flushFolded();
  return rows;
}

const isFaceRow = (row: GridRows[number] | undefined): boolean => {
  const first = row?.[0];
  return first !== undefined && !isPersonCell(first);
};

/** The kind of each row, read off the rows themselves (see FaceRowKind). */
export function faceRowKinds(rows: GridRows, collapsed: ReadonlySet<number>): FaceRowKind[] {
  return rows.map((row, index): FaceRowKind => {
    const first = row[0];
    const nextIsFaces = isFaceRow(rows[index + 1]);
    if (first === undefined || !isPersonCell(first)) return nextIsFaces ? "faces" : "lastFaces";
    if (collapsed.has(first.id)) return "people";
    if (row.length > 1) return "shelf";
    return nextIsFaces ? "header" : "lone";
  });
}

/** The heights of the grid's rows, in order. */
export function faceRowHeights(rows: GridRows, collapsed: ReadonlySet<number>): number[] {
  return faceRowKinds(rows, collapsed).map(rowHeightOf);
}
