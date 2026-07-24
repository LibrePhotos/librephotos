import {
  isGridActionAvailable,
  isGridActionOfflineCapable,
  isViewerActionAvailable,
} from "./offline";

describe("offline availability", () => {
  it("favorite/hide/trash/add-to-album are offline-capable", () => {
    for (const a of ["favorite", "hide", "trash", "addToAlbum"] as const) {
      expect(isGridActionOfflineCapable(a)).toBe(true);
      expect(isGridActionAvailable(a, false)).toBe(true);
    }
  });

  it("download/share-link/delete-permanent are online-only", () => {
    for (const a of ["download", "shareLink", "deletePermanent"] as const) {
      expect(isGridActionOfflineCapable(a)).toBe(false);
      expect(isGridActionAvailable(a, false)).toBe(false);
      expect(isGridActionAvailable(a, true)).toBe(true);
    }
  });

  it("all viewer actions are offline-capable", () => {
    for (const a of ["favorite", "hide", "trash", "restore", "rating", "caption", "addToAlbum"] as const) {
      expect(isViewerActionAvailable(a, false)).toBe(true);
    }
  });
});
