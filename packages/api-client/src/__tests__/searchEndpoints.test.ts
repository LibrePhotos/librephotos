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
