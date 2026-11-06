import { describe, expect, it } from "vitest";
import { buildFaceGridRows, faceGridLayout, faceRowHeights, faceRowKinds, layoutWidthOf } from "./faceGridRows";
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
const THREE_COLUMNS = { columns: 3, faceSize: 100 };
const shape = (rows: GridRows) => rows.map(row => row.map(cell => ("name" in cell ? cell.name : "face")).join(","));

describe("the faces grid's columns", () => {
  it("fits as many 220px columns as the width holds, two faces filling each", () => {
    // The desktop content width at 1440px, less a scrollbar's room: five columns of 227px
    expect(faceGridLayout(layoutWidthOf(1200))).toEqual({ columns: 5, faceSize: 111 });
    // A wide column does not show giant faces
    expect(faceGridLayout(680)).toEqual({ columns: 2, faceSize: 128 });
  });

  it("gives a phone two columns of smaller faces", () => {
    expect(faceGridLayout(layoutWidthOf(366))).toEqual({ columns: 2, faceSize: 86 });
  });
});

describe("the faces grid's rows", () => {
  it("puts groups of up to four faces side by side as tiles, a column each", () => {
    const groups = [group(1, 2), group(2, 1), group(3, 4), group(4, 2)];
    const rows = buildFaceGridRows(groups, THREE_COLUMNS, NOTHING);

    expect(shape(rows)).toEqual(["Group 1,face,face,Group 2,face,Group 3,face,face,face,face", "Group 4,face,face"]);
    expect(faceRowKinds(rows)).toEqual(["tiles", "tiles"]);
  });

  it("opens a group of more than four faces into a header and rows of faces, two a column", () => {
    const rows = buildFaceGridRows([group(1, 2), group(2, 13), group(3, 1)], THREE_COLUMNS, NOTHING);

    expect(rows.map(row => row.length)).toEqual([3, 1, 6, 6, 1, 2]);
    expect(faceRowKinds(rows)).toEqual(["tiles", "header", "faces", "faces", "lastFaces", "tiles"]);
  });

  it("folds a big group into a tile of its first four faces, between the other tiles", () => {
    const folded = new Set([2]);
    const rows = buildFaceGridRows([group(1, 2), group(2, 9), group(3, 2)], THREE_COLUMNS, folded);

    expect(shape(rows)).toEqual(["Group 1,face,face,Group 2,face,face,face,face,Group 3,face,face"]);
  });

  it("makes a tiles row as tall as its tallest tile", () => {
    const twoLines = buildFaceGridRows([group(1, 1), group(2, 3)], THREE_COLUMNS, NOTHING);
    const oneLine = buildFaceGridRows([group(1, 1), group(2, 2)], THREE_COLUMNS, NOTHING);

    const [tall] = faceRowHeights(twoLines, THREE_COLUMNS);
    const [short] = faceRowHeights(oneLine, THREE_COLUMNS);
    // A second line of faces and the 4px above it
    expect((tall ?? 0) - (short ?? 0)).toBe(104);
  });
});
