import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import type { CompletePersonFace } from "../../api_client/faces/types";
import { calculateFaceGridCells } from "../../util/gridUtils";
import { canConfirmFace, groupsByRow, isNamedPerson, wrongMatchFor } from "./faceActionRules";
import { isUnknownGroup } from "./facesTab";

function group(id: number, name: string, kind: string, faceCount = 0): CompletePersonFace {
  return {
    id,
    name,
    kind,
    face_count: faceCount,
    faces: Array.from({ length: faceCount }, (_unused, index) => ({ id: id * 100 + index, face_url: "/f.jpg" })),
  };
}

const ANNA = group(1, "Anna", "USER", 3);
const CLUSTER = group(2, "Unknown 001", "CLUSTER", 1);
// The backend appends this group with its name as its kind
const OTHER = group(0, UNKNOWN_PERSON_NAME, UNKNOWN_PERSON_NAME, 2);

describe("per-face Confirm (#599)", () => {
  it("is offered for an inferred face of a named person", () => {
    expect(canConfirmFace("inferred", ANNA)).toBe(true);
  });

  it.each([
    ["a cluster, whose name is no one's", CLUSTER],
    ["the unknown group", OTHER],
    ["an unknown-kind person", group(3, "Unknown 002", "UNKNOWN")],
  ])("is not offered for %s", (_what, of) => {
    expect(canConfirmFace("inferred", of)).toBe(false);
  });

  it("is not offered on the Labeled and Unknown tabs, where nothing is a guess", () => {
    expect(canConfirmFace("labeled", ANNA)).toBe(false);
    expect(canConfirmFace("unknown", ANNA)).toBe(false);
  });
});

describe("which group is which (#2600)", () => {
  it("tells the unknown group by its name, whose kind is its name too", () => {
    expect(isUnknownGroup(OTHER)).toBe(true);
    expect(isUnknownGroup(ANNA)).toBe(false);
    expect(isUnknownGroup(group(3, "Unknown 002", "UNKNOWN"))).toBe(false);
  });

  it("counts only user-named people as named, never the unknown group", () => {
    expect(isNamedPerson(ANNA)).toBe(true);
    expect(isNamedPerson(OTHER)).toBe(false);
    expect(isNamedPerson(CLUSTER)).toBe(false);
  });
});

describe("the wrong-match menu item", () => {
  it("names the person for a person's face and moves a cluster's face to Unknown - Other", () => {
    expect(wrongMatchFor(ANNA)).toBe("person");
    expect(wrongMatchFor(CLUSTER)).toBe("cluster");
  });

  it("is left out where the faces already are unknown", () => {
    expect(wrongMatchFor(OTHER)).toBeNull();
    expect(wrongMatchFor(group(3, "Unknown 002", "UNKNOWN"))).toBeNull();
  });
});

describe("groupsByRow", () => {
  it("gives every face row the group whose header is above it", () => {
    const { cellContents } = calculateFaceGridCells([ANNA, CLUSTER, OTHER], 2, new Set());

    // Anna: header + 2 rows (3 faces, 2 per row); the cluster: header + 1; the unknown group: header + 1
    expect(groupsByRow(cellContents).map(of => of?.name)).toEqual([
      "Anna",
      "Anna",
      "Anna",
      "Unknown 001",
      "Unknown 001",
      UNKNOWN_PERSON_NAME,
      UNKNOWN_PERSON_NAME,
    ]);
  });

  it("leaves rows above the first header without a group", () => {
    expect(groupsByRow([[{ id: 1 }], [ANNA]])).toEqual([undefined, ANNA]);
  });
});
