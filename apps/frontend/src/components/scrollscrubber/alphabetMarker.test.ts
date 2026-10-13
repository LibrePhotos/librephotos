import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { alphabetMarkerLetter, isUnknownPersonLabel } from "./alphabetMarker";

describe("alphabet markers", () => {
  it.each([
    ["alice", "A"],
    ["Élodie", "E"],
    ["2024 trip", "#"],
    ["(no name)", ":-)"],
  ])("files %s under %s", (label, letter) => {
    expect(alphabetMarkerLetter(label)).toBe(letter);
  });

  it("knows the unknown group by the shared name", () => {
    expect(isUnknownPersonLabel(UNKNOWN_PERSON_NAME)).toBe(true);
    expect(isUnknownPersonLabel("Unknown")).toBe(false);
  });
});
