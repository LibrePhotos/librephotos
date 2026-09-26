import {
  isGridActionAvailable,
  isGridActionOfflineCapable,
  isViewerActionAvailable,
  isViewerActionOfflineCapable,
} from "./offline";
import { OFFLINE_KINDS } from "@/mutations/types";

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

  it("viewer edits that map onto an outbox kind work offline", () => {
    for (const a of [
      "favorite",
      "hide",
      "trash",
      "restore",
      "rating",
      "caption",
      "addToAlbum",
      "removeFromAlbum",
      "renamePerson",
    ] as const) {
      expect(isViewerActionOfflineCapable(a)).toBe(true);
      expect(isViewerActionAvailable(a, false)).toBe(true);
    }
  });

  /**
   * Timestamp edit reorders the timeline and regroups its day/month buckets, so
   * an optimistic offline write would reshuffle the mirror against a change the
   * server has not accepted. Make-public has no mirror-side representation at
   * all. Both are online-only, and must SAY so rather than no-op (doc 07 §4).
   */
  it("timestamp edit and make-public are online-only", () => {
    for (const a of ["timestamp", "makePublic"] as const) {
      expect(isViewerActionOfflineCapable(a)).toBe(false);
      expect(isViewerActionAvailable(a, false)).toBe(false);
      expect(isViewerActionAvailable(a, true)).toBe(true);
    }
  });

  /**
   * The offline set is only meaningful if the outbox can actually replay it —
   * an action marked offline-capable with no matching outbox kind would apply
   * locally and then quietly never reach the server.
   */
  it("every offline-capable viewer action has a matching outbox kind", () => {
    const kindFor: Record<string, string> = {
      favorite: "favorite",
      hide: "hide",
      trash: "trash",
      restore: "trash",
      rating: "rating",
      caption: "caption",
      addToAlbum: "album_add",
      removeFromAlbum: "album_remove",
      renamePerson: "person_rename",
    };
    for (const [action, kind] of Object.entries(kindFor)) {
      expect(isViewerActionOfflineCapable(action as never)).toBe(true);
      expect(OFFLINE_KINDS).toContain(kind);
    }
  });
});
