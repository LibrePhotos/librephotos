import type React from "react";

/** A tile's position and size, as computeLayout / computeLayoutGroups set it. */
export type PigTileStyle = {
  width?: number;
  height?: number;
  translateX?: number;
  translateY?: number;
};

/** The position and size the layout gives every tile it places. */
export type TileLayout = {
  width: number;
  height: number;
  translateX: number;
  translateY: number;
};

/**
 * One tile. Callers pass their own item type (photos carry many more fields);
 * Pig hands copies of those items, with `style` filled in, to its callbacks.
 */
export type ImageItem = {
  id: string | number;
  url?: string;
  /** Width over height; the layout builds its rows from it. */
  aspectRatio: number;
  style?: PigTileStyle;
  isTemp?: boolean;
  dominantColor?: string;
  type?: string;
  /** When it was taken; Tile puts it in its label. */
  date?: string | null;
  /** An HDR video; Tile says so in its label. */
  is_hdr?: boolean;
};

/** A date group of tiles, for `groupByDate`. */
export type GroupedImageItem<T extends ImageItem = ImageItem> = {
  /** The date-album cursor; only the paginated date lists have one. */
  id?: string;
  date: string | null;
  items: T[];
  numberOfItems?: number;
  updated?: boolean;
  groupTranslateY?: number;
  height?: number;
  location?: string | null;
  /** Pig ignores these; the scroll scrubber reads them back from the handle. */
  year?: number | null;
  month?: number | null;
};

/** An entry of Pig's data: a tile, or (with `groupByDate`) a date group. */
export type PigEntry<T extends ImageItem = ImageItem> = T | GroupedImageItem<T>;

/** A tile as Pig lays it out: the caller's item plus its `style` (unset until the first layout). */
export type PigTile<T extends ImageItem = ImageItem> = T & { style?: PigTileStyle };

/** A tile the layout has placed. */
export type LaidOutTile<T extends ImageItem> = T & { style: TileLayout };

/** A date group the layout has placed, with its placed tiles. */
export type LaidOutGroup<T extends ImageItem> = Omit<GroupedImageItem<T>, "items"> & {
  items: LaidOutTile<T>[];
  groupTranslateY: number;
  height: number;
};

/** The whole grid as the layout placed it: flat tiles, or date groups of tiles. */
export type PigLayout<T extends ImageItem> =
  { grouped: false; tiles: LaidOutTile<T>[] } | { grouped: true; groups: LaidOutGroup<T>[] };

/** Whether an entry of Pig's data is a date group rather than a tile. */
export function isGroupEntry<T extends ImageItem>(entry: PigEntry<T>): entry is GroupedImageItem<T> {
  return "items" in entry;
}

/** Whether an entry of Pig's data is a tile rather than a date group. */
export function isTileEntry<T extends ImageItem>(entry: PigEntry<T>): entry is T {
  return !("items" in entry);
}

export type HeaderSize = "large" | "normal" | "small";

export type PigSettings = {
  gridGap: number;
  bgColor: string;
  primaryImageBufferHeight: number;
  secondaryImageBufferHeight: number;
  expandedSize: number;
  thumbnailSize: number;
  groupByDate: boolean;
  breakpoint: number;
  groupGapSm: number;
  groupGapLg: number;
  headerSize?: HeaderSize;
};

/** How fast the user scrolls; tiles only load their images while it is "slow". */
export type ScrollSpeed = "slow" | "medium" | "fast";

/** A tile overlay (favourite star, stack badge, video length); Tile renders it with the tile's item. */
export type PigOverlay<T extends ImageItem> = React.ComponentType<{ item: T }>;
