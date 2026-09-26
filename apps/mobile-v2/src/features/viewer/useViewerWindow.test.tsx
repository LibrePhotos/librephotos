import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react-native";
import { DbProvider } from "@/db/provider";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import type { ViewerSlide } from "@/db/queries/detail";
import { useViewerWindow } from "./useViewerWindow";

/**
 * The pager context used to be `timelinePage(db, { limit: 500 })` on mount: the
 * whole merged timeline query, synchronously, before the tapped photo could be
 * painted, and re-run on every database commit. These tests pin the shape that
 * replaced it — a bounded window anchored on the tapped photo that still reaches
 * both ends of the timeline.
 */

const DAY = 86_400_000;
const N = 200;

function renderWindow(db: TestDb["db"], args: { id: string; seed?: ViewerSlide | null }) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DbProvider db={db} subscribe={() => () => {}}>
      {children}
    </DbProvider>
  );
  const view = renderHook(
    ({ currentIndex }: { currentIndex: number }) =>
      useViewerWindow({ id: args.id, seed: args.seed ?? null, currentIndex }),
    { wrapper, initialProps: { currentIndex: 0 } }
  );
  /**
   * What `PhotoViewerScreen` does whenever the window re-anchors: scroll the
   * pager to the new index, report it back, and acknowledge the restore. The
   * window will not grow until it has heard this, because until then the index
   * it is given describes the previous window.
   */
  const settle = (index?: number) => {
    const target = index ?? view.result.current.restoreIndex ?? 0;
    // Order matters, and matches the screen's layout effect: the pager reports
    // its new index first, and only then acknowledges the restore.
    view.rerender({ currentIndex: target });
    act(() => view.result.current.restored());
  };
  return { ...view, settle };
}

describe("useViewerWindow", () => {
  let t: TestDb;
  /** p000 is the oldest, p199 the newest. */
  const id = (i: number) => `p${String(i).padStart(3, "0")}`;

  beforeEach(() => {
    t = createTestDb();
    seedRemotePhotos(
      t.db,
      Array.from({ length: N }, (_, i) =>
        remotePhoto({ id: id(i), imageHash: `h${i}`, timestamp: Date.UTC(2024, 0, 1) + i * DAY })
      )
    );
  });
  afterEach(() => t.close());

  it("windows around the tapped photo instead of loading the timeline", () => {
    const { result } = renderWindow(t.db, { id: id(100) });
    const keys = result.current.slides.map((s) => s.key);

    expect(keys).toHaveLength(41); // 20 either side + the photo itself
    expect(keys[0]).toBe(id(120)); // newest in the window
    expect(keys[20]).toBe(id(100)); // the tapped photo, centred
    expect(keys[40]).toBe(id(80)); // oldest in the window
    expect(result.current.restoreIndex).toBe(20);
    expect(result.current.atStart).toBe(false);
    expect(result.current.atEnd).toBe(false);
  });

  it("extends into the past as a swipe approaches the end of the window", () => {
    const { result, rerender, settle } = renderWindow(t.db, { id: id(100) });
    const before = result.current.slides.length;
    settle();

    rerender({ currentIndex: before - 1 });

    expect(result.current.slides.length).toBeGreaterThan(before);
    expect(result.current.slides[0].key).toBe(id(120)); // nothing moved
    expect(result.current.slides.at(-1)?.key).toBe(id(60));
  });

  it("extends towards the newest photo and tells the pager how far it shifted", () => {
    const { result, rerender, settle } = renderWindow(t.db, { id: id(100) });
    settle();

    rerender({ currentIndex: 1 });

    expect(result.current.slides[0].key).toBe(id(140));
    expect(result.current.slides).toHaveLength(61);
    // 20 slides were inserted before the current one, so index 1 is now 21.
    expect(result.current.restoreIndex).toBe(21);
  });

  it("reaches the oldest photo and stops", () => {
    const { result, rerender, settle } = renderWindow(t.db, { id: id(100) });
    settle();
    for (let guard = 0; guard < 30 && !result.current.atEnd; guard++) {
      rerender({ currentIndex: result.current.slides.length - 1 });
    }
    expect(result.current.atEnd).toBe(true);
    expect(result.current.slides.at(-1)?.key).toBe(id(0));
    // No duplicates and no gaps on the way down.
    const keys = result.current.slides.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reaches the newest photo and stops", () => {
    const { result, settle } = renderWindow(t.db, { id: id(100) });
    settle();
    for (let guard = 0; guard < 30 && !result.current.atStart; guard++) {
      settle(0);
    }
    expect(result.current.atStart).toBe(true);
    expect(result.current.slides[0].key).toBe(id(199));
    const keys = result.current.slides.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("opens a photo that is not in the timeline at all as a window of one", () => {
    seedRemotePhotos(t.db, [remotePhoto({ id: "hid", imageHash: "hidden-hash", hidden: true })]);
    const { result } = renderWindow(t.db, { id: "hidden-hash" });
    expect(result.current.slides.map((s) => s.image_hash)).toEqual(["hidden-hash"]);
    expect(result.current.atStart).toBe(true);
    expect(result.current.atEnd).toBe(true);
  });

  /**
   * A tap must never be swallowed. A camera-roll asset has no image hash until
   * it is hashed, so the viewer is opened on its asset id — the bug that made
   * the lightbox look unimplemented on a real device.
   */
  it("anchors on an unhashed camera-roll asset", () => {
    insertLocalAsset(t.db, { id: "L7", hash: null, createdAt: Date.UTC(2024, 0, 101) });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["L7"] });

    const { result } = renderWindow(t.db, { id: "L7" });
    const centre = result.current.slides[result.current.restoreIndex ?? 0];
    expect(centre.local_id).toBe("L7");
    expect(centre.local_uri).toBe("ph://L7");
    expect(result.current.slides.length).toBeGreaterThan(1); // still a pager
  });

  it("paints the seeded slide with no timeline row to stand on", () => {
    const empty = createTestDb();
    try {
      const seed: ViewerSlide = {
        key: "ph-1",
        remote_id: null,
        local_id: "ph-1",
        image_hash: null,
        local_uri: "ph://1",
        type: "image",
      };
      const { result } = renderWindow(empty.db, { id: "ph-1", seed });
      expect(result.current.slides).toEqual([seed]);
      expect(result.current.atStart).toBe(true);
      expect(result.current.atEnd).toBe(true);
    } finally {
      empty.close();
    }
  });
});
