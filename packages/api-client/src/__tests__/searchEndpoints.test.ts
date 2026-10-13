/**
 * Search, search examples, place search and media diagnostics (issue #2347): the request each one
 * sends and the parsed answer, against what api/views/search.py, geocode.py and
 * serving_diagnostics.py answered in a test run.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { defined } from "./defined";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";

const pigPhoto = {
  id: "11111111-1111-1111-1111-111111111111",
  image_hash: "p1",
  aspectRatio: 1,
  type: "image",
  rating: 0,
};

describe("search", () => {
  it("searches without a media filter as before", async () => {
    const { client, requests } = fakeServer({ results: [{ date: "2024-04-02", location: "", items: [pigPhoto] }] });
    const result = await endpoints.searchPhotos(client, "beach dog");
    expect(defined(requests[0]).url).toBe(`${API}/photos/searchlist/?search=beach+dog`);
    expect(result.photosFlat).toHaveLength(1);
  });

  it.each([
    [{ photo: true }, "photo=true"],
    [{ video: true }, "video=true"],
    [{ is_screenshot: true }, "is_screenshot=true"],
  ])("narrows the search with %j", async (filter, param) => {
    const { client, requests } = fakeServer({ results: [pigPhoto] });
    const result = await endpoints.searchPhotos(client, "beach", true, filter);
    expect(defined(requests[0]).url).toBe(`${API}/photos/searchlist/?search=beach&${param}`);
    expect(result.photosGroupedByDate).toEqual([]);
  });

  it("sends the structured filters, one person parameter per person", async () => {
    const { client, requests } = fakeServer({ results: [] });
    await endpoints.searchPhotos(client, "", false, {
      video: true,
      camera: "X-T5",
      iso_min: 400,
      aperture_max: 2.8,
      rating_min: 4,
      taken_after: "2024-03-01",
      has_location: false,
      file_type: "raw",
      person: [3, 7],
    });
    expect(defined(requests[0]).url).toBe(
      `${API}/photos/searchlist/?video=true&camera=X-T5&iso_min=400&aperture_max=2.8&rating_min=4` +
        "&taken_after=2024-03-01&has_location=false&file_type=raw&person=3&person=7"
    );
  });

  it("leaves unset filters and an empty person list out", async () => {
    const { client, requests } = fakeServer({ results: [] });
    await endpoints.searchPhotos(client, "beach", false, { lens: undefined, person: [] });
    expect(defined(requests[0]).url).toBe(`${API}/photos/searchlist/?search=beach`);
  });

  it("reads the suggestions of a filter", async () => {
    const { client, requests } = fakeServer({
      results: [
        { value: "X-T5", count: 3 },
        { value: "GR III", count: 1 },
      ],
    });
    const values = await endpoints.fetchMetadataValues(client, "camera");
    expect(defined(requests[0]).url).toBe(`${API}/search/metadata-values/?field=camera`);
    expect(values).toEqual([
      { value: "X-T5", count: 3 },
      { value: "GR III", count: 1 },
    ]);
  });

  it("reads the search examples", async () => {
    const { client, requests } = fakeServer({ results: ["natural light", "2023", "Ontario 2023", "Bob"] });
    const examples = await endpoints.fetchSearchExamples(client);
    expect(defined(requests[0]).url).toBe(`${API}/searchtermexamples/`);
    expect(examples).toEqual(["natural light", "2023", "Ontario 2023", "Bob"]);
  });
});

describe("place search", () => {
  it("asks the geocoder for a name", async () => {
    const { client, requests } = fakeServer([
      { display_name: "Berlin, Deutschland", lat: 52.5170365, lon: 13.3888599 },
      { display_name: "Berlin, Coos County, New Hampshire, United States", lat: 44.4686709, lon: -71.1850764 },
    ]);
    const places = await endpoints.searchGeocode(client, "Berlin & Co");
    expect(defined(requests[0]).url).toBe(`${API}/geocode/search?q=Berlin%20%26%20Co`);
    expect(defined(places[1]).lon).toBe(-71.1850764);
  });
});

describe("reverse geocode", () => {
  it("asks for the place name at a spot", async () => {
    const { client, requests } = fakeServer({ enabled: true, place: "Brandenburger Tor, Pariser Platz, Berlin" });
    const place = await endpoints.reverseGeocode(client, 52.5163, -13.3777);
    expect(defined(requests[0]).url).toBe(`${API}/geocode/reverse/?lat=52.5163&lon=-13.3777`);
    expect(place).toEqual({ enabled: true, place: "Brandenburger Tor, Pariser Platz, Berlin" });
  });

  it("reads a server with reverse geocoding turned off", async () => {
    const { client } = fakeServer({ enabled: false, place: null });
    expect(await endpoints.reverseGeocode(client, 0, 0)).toEqual({ enabled: false, place: null });
  });
});

describe("media diagnostics", () => {
  it("reads a diagnosis", async () => {
    const { client, requests } = fakeServer({
      path: "/data/photos/a.jpg",
      exists: true,
      readable_by_webserver: true,
      cause: "not_mode_bits",
      blocking: null,
      webserver: { uid: 101, gid: 101 },
      mount: null,
      remedies: ["labels"],
    });
    const diagnosis = await endpoints.fetchMediaDiagnostics(client, "h1");
    expect(defined(requests[0]).url).toBe(`${API}/media/diagnostics/h1/`);
    expect(diagnosis.cause).toBe("not_mode_bits");
  });

  it("reads the answer for a photo without a main file, which leaves out webserver and mount", async () => {
    const { client } = fakeServer({ path: null, cause: "missing", blocking: null, remedies: [] });
    const diagnosis = await endpoints.fetchMediaDiagnostics(client, "h1");
    expect(diagnosis.mount).toBeUndefined();
  });
});
