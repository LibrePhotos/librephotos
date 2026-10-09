import { describe, expect, it } from "vitest";
import { eventLocationNames } from "./eventLocations";

const geocoded = (...texts: string[]) => ({ geolocation_json: { features: texts.map(text => ({ text })) } });

describe("eventLocationNames", () => {
  it("names the town-level place of a full geocode", () => {
    expect(eventLocationNames([geocoded("Main St", "Mitte", "Berlin", "Berlin", "Germany")])).toEqual(["Berlin"]);
  });

  // Each of these threw a TypeError and took the whole event page down
  it("copes with short, empty and missing geocodes", () => {
    const photos = [
      geocoded("Valais", "Switzerland"),
      geocoded("Iceland"),
      geocoded(),
      { geolocation_json: {} },
      { geolocation_json: null },
      {},
    ];

    expect(eventLocationNames(photos)).toEqual(["Valais", "Iceland"]);
  });

  it("lists each place once, in the order of the photos", () => {
    const photos = [
      geocoded("a", "Zermatt", "Valais", "Switzerland"),
      geocoded("b", "Täsch", "Valais", "Switzerland"),
      geocoded("c", "Zermatt", "Valais", "Switzerland"),
    ];

    expect(eventLocationNames(photos)).toEqual(["Zermatt", "Täsch"]);
  });
});
