import type { IncompleteDatePhotosGroup, PigPhoto } from "../actions/photosActions.types";
import { MediaType } from "../actions/photosActions.types";
import { PhotosetType, initialPhotosState, photos as photosReducer } from "./photosReducer";

function createPhotosWithIdRange(start: number, end: number, date = "2000-01-01"): PigPhoto[] {
  return Array.from({ length: end - start + 1 }, (_, index) => ({
    aspectRatio: 1,
    id: `${start + index}`,
    isTemp: false,
    rating: 0,
    shared_to: [],
    type: MediaType.IMAGE,
    date,
  }));
}

function createPhotosGroupedByDate(items: { photos: PigPhoto[]; date: string }[]): IncompleteDatePhotosGroup[] {
  return items.map(({ photos, date }, id) => ({
    date,
    id: `${id + 1}`,
    incomplete: true,
    items: photos,
    location: "",
    numberOfItems: photos.length,
  }));
}

describe("photosReducer", () => {
  describe("photo captions", () => {
    test("GENERATE_PHOTO_CAPTION", () => {
      const state = photosReducer(initialPhotosState, {
        type: "GENERATE_PHOTO_CAPTION",
      });
      expect(state.generatingCaptionIm2txt).toBe(true);
    });

    test("GENERATE_PHOTO_CAPTION_FULFILLED", () => {
      const state = photosReducer(initialPhotosState, {
        type: "GENERATE_PHOTO_CAPTION_FULFILLED",
      });
      expect(state.generatingCaptionIm2txt).toBe(false);
      expect(state.generatedCaptionIm2txt).toBe(true);
    });

    test("GENERATE_PHOTO_CAPTION_REJECTED", () => {
      const state = photosReducer(initialPhotosState, {
        type: "GENERATE_PHOTO_CAPTION_REJECTED",
      });
      expect(state.generatingCaptionIm2txt).toBe(false);
      expect(state.generatedCaptionIm2txt).toBe(false);
    });
  });

  describe("recently added photos", () => {
    test("FETCH_RECENTLY_ADDED_PHOTOS", () => {
      const state = photosReducer(initialPhotosState, {
        type: "FETCH_RECENTLY_ADDED_PHOTOS",
      });
      expect(state.fetchedPhotosetType).toBe(PhotosetType.NONE);
    });

    test("FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED", () => {
      const photosFlat = [];
      const date = new Date();
      const state = photosReducer(initialPhotosState, {
        type: "FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED",
        payload: { photosFlat, date },
      });
      expect(state.fetchedPhotosetType).toBe(PhotosetType.RECENTLY_ADDED);
      expect(state.photosFlat).toBe(photosFlat);
      expect(state.recentlyAddedPhotosDate).toBe(date);
    });

    test("FETCH_RECENTLY_ADDED_PHOTOS_REJECTED", () => {
      const state = photosReducer(initialPhotosState, {
        type: "FETCH_RECENTLY_ADDED_PHOTOS_REJECTED",
        payload: "error",
      });
      expect(state.photosFlat).toEqual([]);
      expect(state.fetchedPhotosetType).toBe(PhotosetType.NONE);
      expect(state.photosGroupedByDate).toEqual([]);
      expect(state.photosGroupedByUser).toEqual([]);
      expect(state.error).toBe("error");
    });
  });

  describe("scan photos", () => {
    test("SCAN_PHOTOS", () => {
      const state = photosReducer(initialPhotosState, {
        type: "SCAN_PHOTOS",
      });
      expect(state.scanningPhotos).toBe(true);
    });

    test("SCAN_PHOTOS_REJECTED", () => {
      const state = photosReducer(initialPhotosState, {
        type: "SCAN_PHOTOS_REJECTED",
        payload: "error",
      });
      expect(state.scanningPhotos).toBe(false);
      expect(state.error).toBe("error");
    });

    test("SCAN_PHOTOS_FULFILLED", () => {
      const currentState = { ...initialPhotosState, scanningPhotos: true, scannedPhotos: false };
      const state = photosReducer(currentState, {
        type: "SCAN_PHOTOS_FULFILLED",
      });
      expect(state.scanningPhotos).toBe(false);
      expect(state.scannedPhotos).toBe(true);
    });
  });

  describe("fetch date albums", () => {
    test("FETCH_DATE_ALBUMS_RETRIEVE", () => {
      const state = photosReducer(initialPhotosState, {
        type: "FETCH_DATE_ALBUMS_RETRIEVE",
      });
      expect(state).toEqual(initialPhotosState);
    });

    test("FETCH_DATE_ALBUMS_RETRIEVE_REJECTED", () => {
      const state = photosReducer(initialPhotosState, {
        type: "FETCH_DATE_ALBUMS_RETRIEVE_REJECTED",
        payload: "error",
      });
      expect(state).toEqual({
        ...initialPhotosState,
        error: "error",
      });
    });

    test("FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED no photos", () => {
      const currentState = { ...initialPhotosState, photosGroupedByDate: [] };
      const state = photosReducer(currentState, {
        type: "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED",
        payload: { page: 1 },
      });
      expect(state).toEqual({
        ...currentState,
        photosGroupedByDate: [],
      });
    });

    test("FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED page 1", () => {
      const photosFlat = createPhotosWithIdRange(1, 20);
      const photosGroupedByDate = createPhotosGroupedByDate([{ photos: photosFlat, date: "2000-01-01" }]);
      const currentState = { ...initialPhotosState, photosFlat, photosGroupedByDate };
      const state = photosReducer(currentState, {
        type: "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED",
        payload: {
          page: 1,
          datePhotosGroup: {
            id: "1",
            items: createPhotosWithIdRange(1, 15),
          },
        },
      });
      expect(state).toEqual({
        ...currentState,
        photosGroupedByDate,
        photosFlat: photosFlat.slice(0, 15),
      });
    });

    test("FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED page 2", () => {
      const photosFlat = createPhotosWithIdRange(1, 150);
      const photosGroupedByDate = createPhotosGroupedByDate([{ photos: photosFlat, date: "2000-01-01" }]);
      const currentState = { ...initialPhotosState, photosFlat, photosGroupedByDate };
      const state = photosReducer(currentState, {
        type: "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED",
        payload: {
          page: 2,
          datePhotosGroup: {
            id: "1",
            items: createPhotosWithIdRange(201, 350),
          },
        },
      });
      expect(state).toEqual({
        ...currentState,
        photosGroupedByDate,
        photosFlat: createPhotosWithIdRange(1, 100).concat(createPhotosWithIdRange(201, 350)),
      });
    });

    test("FETCH_DATE_ALBUMS_LIST", () => {
      const state = { ...initialPhotosState, fetchedPhotosetType: PhotosetType.RECENTLY_ADDED };
      const actual = photosReducer(state, {
        type: "FETCH_DATE_ALBUMS_LIST",
      });
      expect(actual).toEqual({
        ...state,
        fetchedPhotosetType: PhotosetType.NONE,
      });
    });

    test("FETCH_DATE_ALBUMS_LIST_REJECTED", () => {
      const actual = photosReducer(initialPhotosState, {
        type: "FETCH_DATE_ALBUMS_LIST_REJECTED",
        payload: "error",
      });
      expect(actual).toEqual({
        ...initialPhotosState,
        error: "error",
      });
    });

    test("FETCH_DATE_ALBUMS_LIST_FULFILLED", () => {
      const currentState = { ...initialPhotosState, photosGroupedByDate: [] };
      const actual = photosReducer(currentState, {
        type: "FETCH_DATE_ALBUMS_LIST_FULFILLED",
        payload: {
          photosFlat: [{ id: 1 }],
          photosGroupedByDate: [{ id: 1 }],
          photosetType: PhotosetType.USER_ALBUM,
        },
      });
      expect(actual).toEqual({
        ...currentState,
        photosFlat: [{ id: 1 }],
        fetchedPhotosetType: PhotosetType.USER_ALBUM,
        photosGroupedByDate: [{ id: 1 }],
      });
    });
  });

  describe("no timestamp photos", () => {
    test("FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED", () => {
      const actual = photosReducer(initialPhotosState, {
        type: "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED",
      });
      expect(actual).toEqual(initialPhotosState);
    });

    test("FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED page 1", () => {
      const state = { ...initialPhotosState, photosFlat: [] };
      const actual = photosReducer(state, {
        type: "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED",
        payload: {
          fetchedPage: 1,
          photosCount: 100,
          photosFlat: createPhotosWithIdRange(1, 100),
        },
      });
      expect(actual).toEqual({
        ...initialPhotosState,
        photosFlat: createPhotosWithIdRange(1, 100),
        fetchedPhotosetType: PhotosetType.NO_TIMESTAMP,
        numberOfPhotos: 100,
      });
    });

    test("FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED page 2", () => {
      const currentState = { ...initialPhotosState, photosFlat: createPhotosWithIdRange(1, 100) };
      const actual = photosReducer(currentState, {
        type: "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED",
        payload: {
          fetchedPage: 2,
          photosCount: 100,
          photosFlat: createPhotosWithIdRange(101, 200),
        },
      });
      expect(actual).toEqual({
        ...currentState,
        photosFlat: createPhotosWithIdRange(1, 200),
        fetchedPhotosetType: PhotosetType.NO_TIMESTAMP,
        numberOfPhotos: 100,
      });
    });

    test("FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_REJECTED", () => {
      const actual = photosReducer(initialPhotosState, {
        type: "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_REJECTED",
        payload: "error",
      });
      expect(actual).toEqual({
        ...initialPhotosState,
        error: "error",
      });
    });
  });

  describe("photoset", () => {
    test("FETCH_PHOTOSET", () => {
      const state = { ...initialPhotosState, fetchedPhotosetType: PhotosetType.NO_TIMESTAMP };
      const actual = photosReducer(state, {
        type: "FETCH_PHOTOSET",
      });
      expect(actual).toEqual({
        ...initialPhotosState,
        fetchedPhotosetType: PhotosetType.NONE,
      });
    });

    test("FETCH_PHOTOSET_FULFILLED", () => {
      const state = { ...initialPhotosState };
      const actual = photosReducer(state, {
        type: "FETCH_PHOTOSET_FULFILLED",
        payload: {
          photosFlat: createPhotosWithIdRange(1, 100),
          photosetType: PhotosetType.PHOTOS,
          photosGroupedByDate: createPhotosWithIdRange(200, 300),
          photosGroupedByUser: createPhotosWithIdRange(300, 400),
        },
      });
      expect(actual).toEqual({
        ...initialPhotosState,
        photosFlat: createPhotosWithIdRange(1, 100),
        fetchedPhotosetType: PhotosetType.PHOTOS,
        photosGroupedByDate: createPhotosWithIdRange(200, 300),
        photosGroupedByUser: createPhotosWithIdRange(300, 400),
      });
    });

    test("FETCH_PHOTOSET_FULFILLED no photos", () => {
      const state = { ...initialPhotosState };
      const actual = photosReducer(state, {
        type: "FETCH_PHOTOSET_FULFILLED",
        payload: {
          photosFlat: createPhotosWithIdRange(1, 100),
          photosetType: PhotosetType.PHOTOS,
        },
      });
      expect(actual).toEqual({
        ...initialPhotosState,
        photosFlat: createPhotosWithIdRange(1, 100),
        fetchedPhotosetType: PhotosetType.PHOTOS,
        photosGroupedByDate: [],
        photosGroupedByUser: [],
      });
    });

    test("FETCH_PHOTOSET_REJECTED", () => {
      const actual = photosReducer(initialPhotosState, {
        type: "FETCH_PHOTOSET_REJECTED",
        payload: "error",
      });
      expect(actual).toEqual({
        ...initialPhotosState,
        error: "error",
      });
    });

    describe("set favourite photos", () => {
      function setRating(photo: PigPhoto, id: string, rating: number): PigPhoto {
        return id !== photo.id ? photo : { ...photo, rating };
      }

      test("SET_PHOTOS_FAVORITE_FULFILLED: update rating", () => {
        const photosFlat = createPhotosWithIdRange(1, 10, "2000-01-01");
        const photosGroupedByDate = createPhotosGroupedByDate([{ photos: photosFlat, date: "2000-01-01" }]);
        const expectedPhotosFlat = photosFlat.map(p => setRating(p, "1", 3));
        const expectedPhotosGroupedByDate = createPhotosGroupedByDate([
          {
            photos: expectedPhotosFlat,
            date: "2000-01-01",
          },
        ]);
        const currentState = {
          ...initialPhotosState,
          photosFlat,
          photosGroupedByDate,
        };
        const actual = photosReducer(currentState, {
          type: "SET_PHOTOS_FAVORITE_FULFILLED",
          payload: {
            updatedPhotos: [{ image_hash: "1", rating: 3 }],
          },
        });
        expect(actual).toEqual({
          ...currentState,
          photosFlat: expectedPhotosFlat,
          photosGroupedByDate: expectedPhotosGroupedByDate,
        });
      });

      test("SET_PHOTOS_FAVORITE_FULFILLED: set favorite", () => {
        const photosFlat = createPhotosWithIdRange(1, 10, "2000-01-01");
        const photosGroupedByDate = createPhotosGroupedByDate([{ photos: photosFlat, date: "2000-01-01" }]);
        const expectedPhotosFlat = photosFlat.map(p => setRating(p, "1", 3));
        const expectedPhotosGroupedByDate = createPhotosGroupedByDate([
          {
            photos: expectedPhotosFlat,
            date: "2000-01-01",
          },
        ]);
        const currentState = {
          ...initialPhotosState,
          fetchedPhotosetType: PhotosetType.FAVORITES,
          photosFlat,
          photosGroupedByDate,
        };
        const actual = photosReducer(currentState, {
          type: "SET_PHOTOS_FAVORITE_FULFILLED",
          payload: {
            favorite: true,
            updatedPhotos: [{ image_hash: "1", rating: 3 }],
          },
        });
        expect(actual).toEqual({
          ...currentState,
          photosFlat: expectedPhotosFlat,
          photosGroupedByDate: expectedPhotosGroupedByDate,
        });
      });

      test("SET_PHOTOS_FAVORITE_FULFILLED: unset favorite", () => {
        const photosFlat = createPhotosWithIdRange(1, 10, "2000-01-01");
        const photosGroupedByDate = createPhotosGroupedByDate([{ photos: photosFlat, date: "2000-01-01" }]);
        const expectedPhotosFlat = photosFlat.filter(p => p.id !== "1");
        const expectedPhotosGroupedByDate = createPhotosGroupedByDate([
          {
            photos: expectedPhotosFlat,
            date: "2000-01-01",
          },
        ]);
        const currentState = {
          ...initialPhotosState,
          fetchedPhotosetType: PhotosetType.FAVORITES,
          photosFlat,
          photosGroupedByDate,
        };
        const actual = photosReducer(currentState, {
          type: "SET_PHOTOS_FAVORITE_FULFILLED",
          payload: {
            favorite: false,
            updatedPhotos: [{ image_hash: "1", rating: 3 }],
          },
        });
        expect(actual.photosFlat).toEqual(expectedPhotosFlat);
        expect(actual.photosGroupedByDate.length).toEqual(1);
        expect(actual.photosGroupedByDate[0].items).toEqual(expectedPhotosGroupedByDate[0].items);
        expect(actual.photosGroupedByDate[0].date).toEqual(expectedPhotosGroupedByDate[0].date);
        expect(actual.photosGroupedByDate[0].id).toEqual(expectedPhotosGroupedByDate[0].id);
        expect(actual.photosGroupedByDate[0].incomplete).toEqual(expectedPhotosGroupedByDate[0].incomplete);
        expect(actual.photosGroupedByDate[0].location).toEqual(expectedPhotosGroupedByDate[0].location);
        expect(actual.photosGroupedByDate[0].numberOfItems).toEqual(10);
      });

      test("SET_PHOTOS_FAVORITE_FULFILLED: unset favorite when image is not in the list", () => {
        const photosFlat = createPhotosWithIdRange(1, 10, "2000-01-01");
        const photosGroupedByDate = createPhotosGroupedByDate([{ photos: photosFlat, date: "2000-01-01" }]);
        const currentState = {
          ...initialPhotosState,
          fetchedPhotosetType: PhotosetType.FAVORITES,
          photosFlat,
          photosGroupedByDate,
        };
        const actual = photosReducer(currentState, {
          type: "SET_PHOTOS_FAVORITE_FULFILLED",
          payload: {
            favorite: false,
            updatedPhotos: [{ image_hash: "9999999", rating: 3 }],
          },
        });
        expect(actual.photosFlat).toEqual(photosFlat);
        expect(actual.photosGroupedByDate).toEqual(photosGroupedByDate);
      });
    });
  });

  describe("fetch user albums", () => {
    test("FETCH_USER_ALBUM_FULFILLED", () => {
      const actual = photosReducer(initialPhotosState, {
        type: "FETCH_USER_ALBUM_FULFILLED",
        payload: {
          photosFlat: createPhotosWithIdRange(1, 10),
          photosGroupedByDate: createPhotosGroupedByDate([
            {
              photos: createPhotosWithIdRange(1, 10),
              date: "2000-01-01",
            },
          ]),
        },
      });
      expect(actual).toEqual({
        ...initialPhotosState,
        photosFlat: createPhotosWithIdRange(1, 10),
        fetchedPhotosetType: PhotosetType.USER_ALBUM,
        photosGroupedByDate: createPhotosGroupedByDate([
          { photos: createPhotosWithIdRange(1, 10), date: "2000-01-01" },
        ]),
      });
    });

    test("FETCH_USER_ALBUM_REJECTED", () => {
      const actual = photosReducer(initialPhotosState, {
        type: "FETCH_USER_ALBUM_REJECTED",
        payload: "error",
      });
      expect(actual).toEqual({
        ...initialPhotosState,
        error: "error",
      });
    });
  });

  describe("generic actions", () => {
    test("auth/logout", () => {
      const state = { ...initialPhotosState, photosFlat: createPhotosWithIdRange(1, 10) };
      const actual = photosReducer(state, {
        type: "auth/logout",
      });
      expect(actual).toEqual(initialPhotosState);
    });

    test("unknown action", () => {
      const state = { ...initialPhotosState };
      const actual = photosReducer(state, {
        type: "unknown",
      });
      expect(actual).toEqual(state);
    });
  });
});
