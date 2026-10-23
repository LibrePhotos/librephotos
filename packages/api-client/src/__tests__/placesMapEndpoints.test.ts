/**
 * The Places map (#343): where my photos were taken, the photos inside a view and the place
 * albums with a photo inside it.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { defined } from "./defined";
import { fakeServer, fakeServerByUrl } from "./harness";

const API = "https://demo.example.com/api";
const VIEW = { south: 47, west: 10.5, north: 49, east: -170 };
const QUERY = "south=47&west=10.5&north=49&east=-170";
const photo = {
  id: "0b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c10",
  image_hash: "h1",
  aspectRatio: 1,
};

describe("the Places map", () => {
  it("reads the points of my photos", async () => {
    const answer = { points: [[48.1, 11.5, 3]], photo_count: 3 };
    const { client, requests } = fakeServer(answer);
    expect(await endpoints.fetchPhotoMapPoints(client)).toEqual(answer);
    expect(defined(requests[0]).url).toBe(`${API}/photos/map-points/`);
  });

  it("refuses a point that is not three numbers", async () => {
    const { client } = fakeServer({ points: [[48.1, 11.5]], photo_count: 1 });
    await expect(endpoints.fetchPhotoMapPoints(client)).rejects.toThrow("photo map points");
  });

  it("follows every page of the photos inside a view", async () => {
    const { client, requests } = fakeServerByUrl(url =>
      url.includes("page=2")
        ? {
            count: 2,
            next: null,
            previous: null,
            results: [{ ...photo, image_hash: "h2" }],
          }
        : {
            count: 2,
            next: `${API}/photos/in-bounds/?${QUERY}&page=2`,
            previous: null,
            results: [photo],
          }
    );
    const photos = await endpoints.fetchPhotosInBounds(client, VIEW);
    expect(photos.map(row => row.image_hash)).toEqual(["h1", "h2"]);
    expect(defined(requests[0]).url).toBe(`${API}/photos/in-bounds/?${QUERY}`);
  });

  it("reads the ids of the place albums inside a view", async () => {
    const { client, requests } = fakeServer({ ids: [3, 7] });
    expect(await endpoints.fetchPlaceAlbumsInBounds(client, VIEW)).toEqual([3, 7]);
    expect(defined(requests[0]).url).toBe(`${API}/albums/place/in-bounds/?${QUERY}`);
  });
});
