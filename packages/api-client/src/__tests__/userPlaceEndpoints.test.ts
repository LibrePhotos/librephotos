/** Your places (#1365): list, draw, change, delete, the editor's preview and a place's photos. */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { defined } from "./defined";
import { fakeServer, fakeServerByUrl } from "./harness";

const API = "https://demo.example.com/api";
const home = {
  id: 3,
  name: "Home",
  icon: "home",
  center_lat: 48.1,
  center_lon: 11.5,
  radius_m: 150,
  use_in_titles: true,
  photo_count: 2,
  cover_photos: [{ image_hash: "h1", video: false }],
};
const fields = {
  name: "Home",
  icon: "home" as const,
  center_lat: 48.1,
  center_lon: 11.5,
  radius_m: 150,
  use_in_titles: true,
};

describe("your places", () => {
  it("reads every page of my places", async () => {
    const { client, requests } = fakeServerByUrl(url =>
      url.includes("page=2")
        ? { count: 2, next: null, previous: null, results: [{ ...home, id: 4, name: "Work" }] }
        : { count: 2, next: `${API}/user-places/?page=2`, previous: null, results: [home] }
    );
    const places = await endpoints.fetchUserPlaces(client);
    expect(places.map(place => place.name)).toEqual(["Home", "Work"]);
    expect(defined(requests[0]).url).toBe(`${API}/user-places/`);
  });

  it("refuses an icon it does not know", async () => {
    const { client } = fakeServer({ count: 1, next: null, previous: null, results: [{ ...home, icon: "castle" }] });
    await expect(endpoints.fetchUserPlaces(client)).rejects.toThrow("user places");
  });

  it("draws a place and changes it", async () => {
    const { client, requests } = fakeServer(home);
    expect(await endpoints.createUserPlace(client, fields)).toEqual(home);
    expect(defined(requests[0])).toEqual({ url: `${API}/user-places/`, method: "POST", body: fields });

    await endpoints.updateUserPlace(client, 3, { radius_m: 200 });
    expect(defined(requests[1])).toEqual({ url: `${API}/user-places/3/`, method: "PATCH", body: { radius_m: 200 } });
  });

  it("deletes a place", async () => {
    const { client, requests } = fakeServer(null);
    await endpoints.deleteUserPlace(client, 3);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/user-places/3/`, method: "DELETE" });
  });

  it("asks what a circle holds, leaving out the place being edited", async () => {
    const preview = {
      photo_count: 4,
      cover_photos: [],
      overlaps: [{ id: 5, name: "Town", photo_count: 2, smaller: false }],
    };
    const { client, requests } = fakeServer(preview);
    expect(await endpoints.fetchUserPlacePreview(client, { lat: 48.1, lon: 11.5, radiusM: 150, exclude: 3 })).toEqual(
      preview
    );
    expect(defined(requests[0]).url).toBe(`${API}/user-places/preview/?lat=48.1&lon=11.5&radius_m=150&exclude=3`);
  });

  it("reads a place's photos by day, narrowed to videos", async () => {
    const { client, requests } = fakeServer({ id: 3, name: "Home", grouped_photos: [] });
    expect((await endpoints.fetchUserPlacePhotos(client, 3, { video: true })).name).toBe("Home");
    expect(defined(requests[0]).url).toBe(`${API}/user-places/3/photos/?video=true`);
  });
});
