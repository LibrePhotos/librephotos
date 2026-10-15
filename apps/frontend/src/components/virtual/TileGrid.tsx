import React, { useCallback, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ScrollRestoredVirtualGrid } from "./ScrollRestoredVirtualGrid";
import classes from "./TileGrid.module.css";
import { VirtualGrid } from "./VirtualGrid";
import type { GridCellProps } from "./VirtualGrid";

/** How a tile grid is laid out: computed by a sizing hook (useAlbumListGridConfig, useMeasuredTileSizing). */
export type TileGridSizing = Readonly<{
  columnCount: number;
  /** Width of one column. A tile is this less the cell padding on both sides. */
  columnWidth: number;
  /** Space left around a tile inside its column. */
  cellPadding: number;
  /** Height of whatever sits under the tile; a row is columnWidth + captionHeight tall. */
  captionHeight: number;
  /** Height of the scroll viewport. */
  height: number;
  /** Left padding of the scroll container. */
  gutter: number;
}>;

/** A run of tiles under a header row of its own (one per sharing user). */
export type TileGroup<T> = Readonly<{
  key: string | number;
  header: ReactNode;
  items: readonly T[];
}>;

type TileGridProps<T> = Readonly<
  {
    getKey: (item: T) => string | number;
    /** The tile itself, `size` px square, inside the padded cell. */
    renderItem: (item: T, size: number) => ReactNode;
    /** Below the padded cell, in the caption height. Leave out when renderItem draws its own caption. */
    renderCaption?: (item: T) => ReactNode;
    sizing: TileGridSizing;
    /**
     * A name for the grid, unique across the app, to come back to the same scroll position on
     * Back (#377). Needs a router; leave it out where the position should not be kept.
     */
    scrollRestorationId?: string;
  } & (
    | { items: readonly T[]; groups?: undefined; headerHeight?: undefined }
    | { groups: readonly TileGroup<T>[]; headerHeight: number; items?: undefined }
  )
>;

type TileRow<T> = Readonly<{ kind: "header"; group: TileGroup<T> }> | Readonly<{ kind: "tiles"; items: readonly T[] }>;

function tileRows<T>(items: readonly T[], columnCount: number): TileRow<T>[] {
  const rows: TileRow<T>[] = [];
  for (let start = 0; start < items.length; start += columnCount) {
    rows.push({ kind: "tiles", items: items.slice(start, start + columnCount) });
  }
  return rows;
}

/**
 * The one grid for fixed-size tiles (albums, people, places, folders): rows virtualized through
 * VirtualGrid, so a list that grows with the library only mounts the rows in view. It owns the
 * cell index math, the empty cells past the end of a row and the padding around each tile.
 * Photo layouts go through PhotoListView instead.
 */
export function TileGrid<T>(props: TileGridProps<T>) {
  const { getKey, renderItem, renderCaption, sizing, scrollRestorationId } = props;
  const { columnCount, columnWidth, cellPadding, captionHeight, height, gutter } = sizing;
  // The album sizing has 0 columns until its first effect has run
  const columns = Math.max(0, Math.ceil(columnCount));

  const rows = useMemo(() => {
    if (columns === 0) return [];
    if (props.groups === undefined) return tileRows(props.items, columns);
    return props.groups.flatMap((group): TileRow<T>[] => [
      { kind: "header", group },
      ...tileRows(group.items, columns),
    ]);
  }, [props.items, props.groups, columns]);

  const tileRowHeight = columnWidth + captionHeight;
  const { headerHeight } = props;
  const rowHeight = useCallback(
    ({ index }: { index: number }) =>
      rows[index]?.kind === "header" && headerHeight !== undefined ? headerHeight : tileRowHeight,
    [rows, headerHeight, tileRowHeight]
  );

  const tileSize = columnWidth - 2 * cellPadding;

  const renderCell = ({ columnIndex, key, rowIndex, style }: GridCellProps) => {
    const row = rows[rowIndex];
    if (row === undefined) return null;
    if (row.kind === "header") {
      // One cell across the whole row
      if (columnIndex > 0) return null;
      return (
        <div key={`header-${row.group.key}`} style={{ ...style, width: columns * columnWidth }}>
          {row.group.header}
        </div>
      );
    }
    const item = row.items[columnIndex];
    if (item === undefined) {
      return <div key={key} style={style} />;
    }
    return (
      <div key={getKey(item)} style={style}>
        <div className={classes.cell}>{renderItem(item, tileSize)}</div>
        {renderCaption?.(item)}
      </div>
    );
  };

  // The padding is a variable on the container, so the cells carry a class and no inline style.
  const containerStyle: CSSProperties & Record<"--tile-grid-cell-padding", string> = {
    outline: "none",
    paddingLeft: gutter,
    "--tile-grid-cell-padding": `${cellPadding}px`,
  };

  const gridProps = {
    style: containerStyle,
    cellRenderer: renderCell,
    columnWidth,
    columnCount: columns,
    height,
    // A constant when there are no header rows, as the album grids always passed
    rowHeight: props.groups === undefined ? tileRowHeight : rowHeight,
    rowCount: rows.length,
  };

  return scrollRestorationId === undefined ? (
    <VirtualGrid {...gridProps} />
  ) : (
    <ScrollRestoredVirtualGrid {...gridProps} scrollRestorationId={scrollRestorationId} />
  );
}
