import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { GALLERY_UNDATED_DAY_ID } from "../schemas";
import { defined } from "./defined";
import { fakeServer, fakeServerByUrl } from "./harness";

const owner = { id: 2, username: "anna", first_name: "Anna", last_name: "Berger" };
const cover = { image_hash: "abc", video: false };

describe("public gallery endpoints (#434)", () => {
  it("reads whether the gallery is open", async () => {
    const { client, requests } = fakeServer({
      stage: "everyone",
      indexable: false,
      photo_count: 12,
      photographer_count: 2,
    });
    const gallery = await endpoints.fetchGallery(client);
    expect(gallery.photo_count).toBe(12);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/gallery/");
  });

  it("reads the timeline as day groups for the photo list, undated last", async () => {
    const { client, requests } = fakeServer({
      results: [
        { id: 20250816, date: "2025-08-16", location: "Munich", photo_count: 3 },
        { id: GALLERY_UNDATED_DAY_ID, date: null, location: "", photo_count: 1 },
      ],
    });
    const days = await endpoints.fetchGalleryDays(client, { owner: 2, place: "Munich" });
    expect(days).toEqual([
      { id: 20250816, date: "2025-08-16", location: "Munich", incomplete: true, numberOfItems: 3, items: [] },
      { id: 1, date: null, location: "", incomplete: true, numberOfItems: 1, items: [] },
    ]);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/gallery/days/?owner=2&place=Munich");
  });

  it("reads a page of a day's photos with the filters", async () => {
    const { client, requests } = fakeServer({ count: 0, next: null, previous: null, results: [] });
    await endpoints.fetchGalleryDayPhotos(client, 20250816, 2, { person: 7 });
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/gallery/photos/?person=7&day=20250816&page=2");
  });

  it("reads every page of the places, people and photographers", async () => {
    const page = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });
    const { client, requests } = fakeServerByUrl(url => {
      if (url.includes("/places/")) {
        return page([{ name: "Munich", photo_count: 3, owner_ids: [2], cover_photos: [cover] }]);
      }
      if (url.includes("/people/")) return page([{ id: "7", name: "Mia", owner, photo_count: 1, face_url: null }]);
      return page([{ ...owner, photo_count: 3, cover_photos: [cover] }]);
    });
    const [place] = await endpoints.fetchGalleryPlaces(client, 2);
    const [person] = await endpoints.fetchGalleryPeople(client);
    const [photographer] = await endpoints.fetchGalleryPhotographers(client);
    expect(defined(place).name).toBe("Munich");
    expect(defined(person).id).toBe(7);
    expect(defined(photographer).username).toBe("anna");
    expect(requests.map(request => request.url)).toEqual([
      "https://demo.example.com/api/gallery/places/?owner=2",
      "https://demo.example.com/api/gallery/people/",
      "https://demo.example.com/api/gallery/photographers/",
    ]);
  });

  it("reads the admin's preview", async () => {
    const { client } = fakeServer({ photo_count: 3, photographer_count: 1, photographers: [] });
    expect((await endpoints.fetchGalleryPreview(client)).photographer_count).toBe(1);
  });
});
