/**
 * Setting the location of selected photos (#2279): the bulk request, the selection summary the
 * dialog shows first, and the geotagged photos it offers to copy a location from.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { defined } from "./defined";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";
const located = {
  id: "0b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c10",
  image_hash: "h2",
  exif_timestamp: "2026-10-11T09:43:00Z",
  exif_gps_lat: 41.14,
  exif_gps_lon: -8.61,
  place: "Ribeira, Porto, Portugal",
  short_place: "Porto",
};

describe("photo locations", () => {
  it("sends the hashes, the spot and the overwrite choice", async () => {
    const { client, requests } = fakeServer({ count: 2, skipped_with_location: 1, geocoded: true });
    const answer = await endpoints.setPhotosLocation(client, ["h1"], { lat: 41.14, lon: -8.61, overwrite: false });
    expect(defined(requests[0])).toEqual({
      url: `${API}/photosedit/location/`,
      method: "POST",
      body: { image_hashes: ["h1"], lat: 41.14, lon: -8.61, overwrite: false },
    });
    expect(answer).toEqual({ count: 2, skipped_with_location: 1, geocoded: true });
  });

  it("sends a selected-all set as the query and its exclusions", async () => {
    const { client, requests } = fakeServer({ count: 7, skipped_with_location: 0, geocoded: false });
    await endpoints.setPhotosLocation(
      client,
      [],
      { lat: 1, lon: 2, overwrite: true },
      { query: { favorite: true }, excludedHashes: ["x"] }
    );
    expect(defined(requests[0]).body).toEqual({
      select_all: true,
      query: { favorite: true },
      excluded_hashes: ["x"],
      lat: 1,
      lon: 2,
      overwrite: true,
    });
  });

  it("reads the summary of a selection", async () => {
    const summary = {
      count: 24,
      with_location: 9,
      places: [{ place: "Porto", count: 9 }],
      first_taken: "2026-10-10T08:00:00Z",
      last_taken: null,
    };
    const { client, requests } = fakeServer(summary);
    expect(await endpoints.fetchLocationSummary(client, ["h1", "h2"])).toEqual(summary);
    expect(defined(requests[0])).toEqual({
      url: `${API}/photos/location-summary/`,
      method: "POST",
      body: { image_hashes: ["h1", "h2"] },
    });
  });

  it("asks for the located photos of a window, encoded", async () => {
    const { client, requests } = fakeServer([located]);
    const photos = await endpoints.fetchLocatedNearbyInTime(
      client,
      "2026-10-10T00:00:00+02:00",
      "2026-10-12T00:00:00Z"
    );
    expect(photos).toEqual([located]);
    expect(defined(requests[0]).url).toBe(
      `${API}/photos/located-nearby-in-time/?from=2026-10-10T00%3A00%3A00%2B02%3A00&to=2026-10-12T00%3A00%3A00Z`
    );
  });
});
