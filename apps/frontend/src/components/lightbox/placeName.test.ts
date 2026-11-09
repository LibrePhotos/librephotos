import { describe, expect, it } from "vitest";
import { placeRegion, shortPlace } from "./placeName";

const HONOLULU = "Diamond Head / Kapahulu / Saint Louis Heights, Honolulu County, Hawaii, United States";

describe("placeName", () => {
  it("keeps the first two levels, comma-separated", () => {
    expect(shortPlace("Baixa, Lisbon, Portugal")).toBe("Baixa, Lisbon");
    expect(placeRegion("Baixa, Lisbon, Portugal")).toBe("Portugal");
  });

  it("names a level that lists several places by its first", () => {
    expect(shortPlace(HONOLULU)).toBe("Diamond Head, Honolulu County");
    expect(placeRegion(HONOLULU)).toBe("Hawaii, United States");
  });

  it("has no region for a short name", () => {
    expect(shortPlace("Madrid, Spain")).toBe("Madrid, Spain");
    expect(placeRegion("Madrid, Spain")).toBe("");
    expect(shortPlace(" , ")).toBe("");
  });
});
