import type { ImageItem, LaidOutGroup, LaidOutTile, PigLayout } from "./types";

/**
 * The tile at the top of the screen, by its place in the data: a group (by id, or date where it
 * has none) and the tile's index in it. An index names the same photo before and after a page of
 * a day loads, since pages replace placeholders in place.
 */
export type ScrollAnchor = {
  groupKey: string | null;
  index: number;
  /** Where the tile was, from the top of the grid. */
  tileTop: number;
  /** Where its group was; read when the tile is gone. */
  groupTop: number;
};

const groupKeyOf = <T extends ImageItem>(group: LaidOutGroup<T>): string =>
  group.id !== undefined ? `id:${group.id}` : `date:${group.date ?? ""}`;

// The first tile whose bottom is below `viewTop`; tiles are in layout order, top to bottom.
function firstTileBelow<T extends ImageItem>(tiles: readonly LaidOutTile<T>[], viewTop: number): number {
  let low = 0;
  let high = tiles.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const tile = tiles[mid];
    if (tile !== undefined && tile.style.translateY + tile.style.height <= viewTop) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The tile a reader is looking at in `layout` when the top of the screen is `viewTop` pixels below
 * the top of the grid. Null at the top of the grid, where nothing needs to keep still.
 */
export function findScrollAnchor<T extends ImageItem>(layout: PigLayout<T>, viewTop: number): ScrollAnchor | null {
  if (viewTop <= 0) return null;
  if (!layout.grouped) {
    const index = firstTileBelow(layout.tiles, viewTop);
    const tile = layout.tiles[index];
    if (tile === undefined) return null;
    return { groupKey: null, index, tileTop: tile.style.translateY, groupTop: 0 };
  }
  const group = layout.groups.find(g => g.groupTranslateY + g.height > viewTop);
  if (group === undefined) return null;
  const index = Math.min(firstTileBelow(group.items, viewTop), Math.max(group.items.length - 1, 0));
  const tile = group.items[index];
  return {
    groupKey: groupKeyOf(group),
    index,
    tileTop: tile?.style.translateY ?? group.groupTranslateY,
    groupTop: group.groupTranslateY,
  };
}

/**
 * How far the anchored tile moved in the new `layout`: scrolling by that keeps it where the reader
 * saw it. 0 when its group is gone (another list).
 */
export function anchorShift<T extends ImageItem>(layout: PigLayout<T>, anchor: ScrollAnchor): number {
  if (!layout.grouped) {
    const tile = anchor.groupKey === null ? layout.tiles[anchor.index] : undefined;
    return tile === undefined ? 0 : tile.style.translateY - anchor.tileTop;
  }
  const group = layout.groups.find(g => groupKeyOf(g) === anchor.groupKey);
  if (group === undefined) return 0;
  const tile = group.items[anchor.index];
  if (tile === undefined) return group.groupTranslateY - anchor.groupTop;
  return tile.style.translateY - anchor.tileTop;
}
