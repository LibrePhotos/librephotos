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

// #2302: a geocode written since then says which level each feature is
const typed = (...features: [string, unknown][]) => ({
  geolocation_json: { features: features.map(([text, place_type]) => ({ text, place_type })) },
});

describe("eventLocationNames with typed geocodes", () => {
  it("names the town of an ExifTool geocode, not the subregion third from the end", () => {
    const zermatt = typed(
      ["Zermatt", "city"],
      ["Visp District", "subregion"],
      ["Valais", "region"],
      ["Switzerland", "country"]
    );
    const lisbon = typed(["Lisbon", "city"], ["Portugal", "country"]);

    expect(eventLocationNames([zermatt, lisbon])).toEqual(["Zermatt", "Lisbon"]);
  });

  it("names the town of a typed Nominatim geocode, skipping the street", () => {
    const sydney = typed(
      ["Beach Road", "street"],
      ["Bondi Beach", "locality"],
      ["Sydney", "city"],
      ["New South Wales", "region"],
      ["Australia", "country"]
    );

    expect(eventLocationNames([sydney])).toEqual(["Sydney"]);
  });

  it("falls back to the nearest finer level, then the nearest coarser one", () => {
    const hamlet = typed(["Fire Route 47", "street"], ["Spangmik", "locality"], ["Ladakh", "region"]);
    const county = typed(["Fire Route 47", "street"], ["Peterborough County", "subregion"], ["Canada", "country"]);

    expect(eventLocationNames([hamlet, county])).toEqual(["Spangmik", "Peterborough County"]);
  });

  it("reads the place_type lists and Mapbox type names of older Mapbox geocodes", () => {
    const mapbox = typed(["Kreuzberg", ["neighborhood"]], ["Lakefield", ["place"]], ["Canada", ["country"]]);
    // Berlin is a region and a place: the finer type counts
    const cityState = typed(["Kreuzberg", ["locality"]], ["Berlin", ["region", "place"]], ["Germany", ["country"]]);

    expect(eventLocationNames([mapbox, cityState])).toEqual(["Lakefield", "Berlin"]);
  });

  it("reads untyped features by position when only streets and POIs are typed", () => {
    const poi = typed(
      ["Main St", "street"],
      ["Mitte", null],
      ["Berlin", undefined],
      ["Berlin", 3],
      ["Germany", "planet"]
    );

    expect(eventLocationNames([poi])).toEqual(["Berlin"]);
  });
});
