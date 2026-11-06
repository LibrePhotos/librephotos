import { chunk } from "lodash-es";
import React, { useMemo } from "react";
import type { CompletePersonFace } from "../../api_client/faces/types";
import classes from "./FaceGridRow.module.css";
import type { FaceGridLayout, FaceRowKind } from "./faceGridRows";
import type { GridCell } from "./hooks/useVirtualizedGrid";
import { isPersonCell } from "./hooks/useVirtualizedGrid";

/** A group's name line: under its faces on a tile, above them on an open group. */
export type HeaderVariant = "tile" | "section";

type Props = Readonly<{
  kind: FaceRowKind;
  cells: readonly GridCell[];
  layout: FaceGridLayout;
  /** The grid's placement of the row. */
  style: React.CSSProperties;
  /** The group of a face row: the header row above it. A tile names its own. */
  group: CompletePersonFace | undefined;
  renderHeader: (group: CompletePersonFace, variant: HeaderVariant) => React.ReactNode;
  renderFace: (face: GridCell, group: CompletePersonFace | undefined) => React.ReactNode;
}>;

type Tile = { group: CompletePersonFace; faces: GridCell[] };

/** A tiles row's tiles: each group with the faces that follow it. */
function tilesOf(cells: readonly GridCell[]): Tile[] {
  const tiles: Tile[] = [];
  for (const cell of cells) {
    if (isPersonCell(cell)) tiles.push({ group: cell, faces: [] });
    else tiles.at(-1)?.faces.push(cell);
  }
  return tiles;
}

/** Faces two by two, each in a square cell of the layout's face size. */
function FacePair({
  faces,
  group,
  layout,
  renderFace,
}: Readonly<{
  faces: readonly GridCell[];
  group: CompletePersonFace | undefined;
  layout: FaceGridLayout;
  renderFace: Props["renderFace"];
}>) {
  const pairStyle = useMemo(() => ({ gridTemplateColumns: `repeat(2, ${layout.faceSize}px)` }), [layout.faceSize]);
  const cellStyle = useMemo(() => ({ width: layout.faceSize, height: layout.faceSize }), [layout.faceSize]);
  return (
    <div className={classes.faces} style={pairStyle}>
      {faces.map((face, index) => (
        // A placeholder's id is its index, which a loaded face's id can repeat: the place is the key
        // eslint-disable-next-line react/no-array-index-key -- the faces of one group keep their order
        <div key={index} className={classes.faceCell} style={cellStyle}>
          {renderFace(face, group)}
        </div>
      ))}
    </div>
  );
}

/**
 * One row of the faces grid (see faceGridRows.ts): tiles side by side, or a slice of an open group
 * (its header, a row of its faces, the last row).
 */
export function FaceGridRow({ kind, cells, layout, style, group, renderHeader, renderFace }: Props) {
  const first = cells[0];
  const rowStyle = useMemo(
    () => ({ ...style, gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }),
    [style, layout.columns]
  );
  switch (kind) {
    case "tiles":
      return (
        <div style={rowStyle} className={classes.columns}>
          {tilesOf(cells).map(tile => (
            <div key={tile.group.id} className={classes.tile}>
              {tile.faces.length > 0 && (
                <FacePair faces={tile.faces} group={tile.group} layout={layout} renderFace={renderFace} />
              )}
              {renderHeader(tile.group, "tile")}
            </div>
          ))}
        </div>
      );
    case "header":
      return (
        <div style={style} className={classes.header}>
          {first && isPersonCell(first) ? renderHeader(first, "section") : null}
        </div>
      );
    case "faces":
    case "lastFaces":
      // Two faces a column, so an open group's faces line up with the tiles' faces
      return (
        <div style={rowStyle} className={classes.columns}>
          {chunk(cells, 2).map((pair, index) => (
            // eslint-disable-next-line react/no-array-index-key -- a row's columns keep their order
            <FacePair key={index} faces={pair} group={group} layout={layout} renderFace={renderFace} />
          ))}
        </div>
      );
  }
}
