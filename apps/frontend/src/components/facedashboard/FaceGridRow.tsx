import cx from "clsx";
import React from "react";
import type { CompletePersonFace } from "../../api_client/faces/types";
import classes from "./FaceGridRow.module.css";
import { cardWidthOf } from "./faceGridRows";
import type { FaceRowKind } from "./faceGridRows";
import type { GridCell } from "./hooks/useVirtualizedGrid";
import { isPersonCell } from "./hooks/useVirtualizedGrid";

type Props = Readonly<{
  kind: FaceRowKind;
  cells: readonly GridCell[];
  /** The grid's placement of the row. */
  style: React.CSSProperties;
  /** The group of a face row: the header row above it. A shelf's cards name their own. */
  group: CompletePersonFace | undefined;
  renderHeader: (group: CompletePersonFace) => React.ReactNode;
  renderFace: (face: GridCell, group: CompletePersonFace | undefined) => React.ReactNode;
  renderPerson: (person: CompletePersonFace) => React.ReactNode;
}>;

type ShelfCard = { group: CompletePersonFace; faces: GridCell[] };

/** A shelf row's cards: each group with the faces that follow it. */
function shelfCards(cells: readonly GridCell[]): ShelfCard[] {
  const cards: ShelfCard[] = [];
  for (const cell of cells) {
    if (isPersonCell(cell)) cards.push({ group: cell, faces: [] });
    else cards.at(-1)?.faces.push(cell);
  }
  return cards;
}

function Faces({
  faces,
  group,
  renderFace,
}: Readonly<{ faces: readonly GridCell[]; group: CompletePersonFace | undefined; renderFace: Props["renderFace"] }>) {
  return (
    <div className={classes.faces}>
      {faces.map((face, index) => (
        // A placeholder's id is its index, which a loaded face's id can repeat: the place is the key
        // eslint-disable-next-line react/no-array-index-key -- the faces of one group keep their order
        <div key={index} className={classes.faceCell}>
          {renderFace(face, group)}
        </div>
      ))}
    </div>
  );
}

/**
 * One row of the faces grid (see faceGridRows.ts): a shelf of small cards, a slice of a wide card
 * (its header, a row of its faces, the last row), or a row of folded people.
 */
export function FaceGridRow({ kind, cells, style, group, renderHeader, renderFace, renderPerson }: Props) {
  const first = cells[0];
  switch (kind) {
    case "people":
      return (
        <div style={style} className={classes.people}>
          {cells.map(cell =>
            isPersonCell(cell) ? <React.Fragment key={cell.id}>{renderPerson(cell)}</React.Fragment> : null
          )}
        </div>
      );
    case "shelf":
      return (
        <div style={style} className={classes.shelf}>
          {shelfCards(cells).map(card => {
            const width = { width: cardWidthOf(card.faces.length) };
            return (
              <div key={card.group.id} className={cx(classes.card, classes.shelfCard)} style={width}>
                <div className={classes.header}>{renderHeader(card.group)}</div>
                <Faces faces={card.faces} group={card.group} renderFace={renderFace} />
              </div>
            );
          })}
        </div>
      );
    case "header":
    case "lone":
      return (
        <div style={style} className={classes.slot}>
          <div className={cx(classes.card, kind === "header" ? classes.top : classes.lone)}>
            {first && isPersonCell(first) ? renderHeader(first) : null}
          </div>
        </div>
      );
    case "faces":
    case "lastFaces":
      return (
        <div style={style} className={classes.slot}>
          <div className={cx(classes.card, kind === "faces" ? classes.middle : classes.bottom)}>
            <Faces faces={cells} group={group} renderFace={renderFace} />
          </div>
        </div>
      );
  }
}
