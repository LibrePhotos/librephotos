import { describe, expect, it } from "vitest";
import { buildFaceGridRows, cardWidthOf, faceRowKinds, rowHeightOf } from "./faceGridRows";
import type { GridRows } from "./hooks/useVirtualizedGrid";

const group = (id: number, faceCount: number) => ({
  id,
  name: `Group ${id}`,
  kind: "CLUSTER",
  face_count: faceCount,
  faces: Array.from({ length: faceCount }, (_unused, index) => ({
    id: index,
    image: null,
    face_url: null,
    photo: "",
    person: id,
    isTemp: true,
  })),
});

const NOTHING = new Set<number>();
const shape = (rows: GridRows) => rows.map(row => row.map(cell => ("name" in cell ? cell.name : "face")).join(","));

describe("the faces grid's cards", () => {
  it("puts small groups side by side on one row, as many as fit", () => {
    // Three 264px cards fit 900px with their 12px gaps, the fourth starts the next row
    const groups = [group(1, 2), group(2, 1), group(3, 2), group(4, 2)];
    const rows = buildFaceGridRows(groups, 900, NOTHING);

    expect(shape(rows)).toEqual(["Group 1,face,face,Group 2,face,Group 3,face,face", "Group 4,face,face"]);
    expect(faceRowKinds(rows, NOTHING)).toEqual(["shelf", "shelf"]);
  });

  it("gives a group too wide for one line a card of its own, cut into rows", () => {
    const rows = buildFaceGridRows([group(1, 2), group(2, 25), group(3, 1)], 900, NOTHING);

    // 900px holds 11 faces a line inside a card's padding
    expect(rows.map(row => row.length)).toEqual([3, 1, 11, 11, 3, 2]);
    expect(faceRowKinds(rows, NOTHING)).toEqual(["shelf", "header", "faces", "faces", "lastFaces", "shelf"]);
  });

  it("keeps folded groups in rows of people between the cards", () => {
    const folded = new Set([2, 3]);
    const rows = buildFaceGridRows([group(1, 2), group(2, 2), group(3, 9), group(4, 2)], 900, folded);

    expect(shape(rows)).toEqual(["Group 1,face,face", "Group 2,Group 3", "Group 4,face,face"]);
    expect(faceRowKinds(rows, folded)).toEqual(["shelf", "people", "shelf"]);
  });

  it("sizes a card to its faces, never narrower than its header needs", () => {
    expect(cardWidthOf(1)).toBe(264);
    expect(cardWidthOf(10)).toBe(816);
    expect(rowHeightOf("shelf")).toBeGreaterThan(rowHeightOf("faces"));
  });
});
