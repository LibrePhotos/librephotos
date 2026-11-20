import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react-native";
import { DbProvider } from "@/db/provider";
import { settleDb } from "@/test/test-utils";
import {
  createTestDb,
  insertLocalAlbum,
  insertLocalAsset,
  remotePhoto,
  seedRemotePhotos,
  type TestDb,
} from "@librephotos/local-db/testing";
import type { ViewerSlide } from "@librephotos/local-db";
import { useViewerWindow } from "./useViewerWindow";

const DAY = 86_400_000;
const N = 200;

async function renderWindow(db: TestDb["db"], args: { id: string; seed?: ViewerSlide | null }) {
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
  await settleDb();
  const settle = async (index?: number) => {
    const target = index ?? view.result.current.restoreIndex ?? 0;
    view.rerender({ currentIndex: target });
    act(() => view.result.current.restored());
    await settleDb();
  };
  return { ...view, settle };
}

describe("useViewerWindow", () => {
  let t: TestDb;
  const id = (i: number) => `p${String(i).padStart(3, "0")}`;

  beforeEach(async () => {
    t = createTestDb();
    await seedRemotePhotos(
      t.db,
      Array.from({ length: N }, (_, i) =>
        remotePhoto({ id: id(i), imageHash: `h${i}`, timestamp: Date.UTC(2024, 0, 1) + i * DAY })
      )
    );
  });
  afterEach(() => t.close());

  it("windows around the tapped photo instead of loading the timeline", async () => {
    const { result } = await renderWindow(t.db, { id: id(100) });
    const keys = result.current.slides.map((s) => s.key);

    expect(keys).toHaveLength(41);
    expect(keys[0]).toBe(id(120));
    expect(keys[20]).toBe(id(100));
    expect(keys[40]).toBe(id(80));
    expect(result.current.restoreIndex).toBe(20);
    expect(result.current.atStart).toBe(false);
    expect(result.current.atEnd).toBe(false);
  });

  it("extends into the past as a swipe approaches the end of the window", async () => {
    const { result, rerender, settle } = await renderWindow(t.db, { id: id(100) });
    const before = result.current.slides.length;
    await settle();

    rerender({ currentIndex: before - 1 });

    await settleDb();

    expect(result.current.slides.length).toBeGreaterThan(before);
    expect(result.current.slides[0].key).toBe(id(120));
    expect(result.current.slides.at(-1)?.key).toBe(id(60));
  });

  it("extends towards the newest photo and tells the pager how far it shifted", async () => {
    const { result, rerender, settle } = await renderWindow(t.db, { id: id(100) });
    await settle();

    rerender({ currentIndex: 1 });

    await settleDb();

    expect(result.current.slides[0].key).toBe(id(140));
    expect(result.current.slides).toHaveLength(61);
    expect(result.current.restoreIndex).toBe(21);
  });

  it("reaches the oldest photo and stops", async () => {
    const { result, rerender, settle } = await renderWindow(t.db, { id: id(100) });
    await settle();
    for (let guard = 0; guard < 30 && !result.current.atEnd; guard++) {
      rerender({ currentIndex: result.current.slides.length - 1 });
      await settleDb();
    }
    expect(result.current.atEnd).toBe(true);
    expect(result.current.slides.at(-1)?.key).toBe(id(0));
    const keys = result.current.slides.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reaches the newest photo and stops", async () => {
    const { result, settle } = await renderWindow(t.db, { id: id(100) });
    await settle();
    for (let guard = 0; guard < 30 && !result.current.atStart; guard++) {
      await settle(0);
    }
    expect(result.current.atStart).toBe(true);
    expect(result.current.slides[0].key).toBe(id(199));
    const keys = result.current.slides.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("opens a photo that is not in the timeline at all as a window of one", async () => {
    await seedRemotePhotos(t.db, [remotePhoto({ id: "hid", imageHash: "hidden-hash", hidden: true })]);
    const { result } = await renderWindow(t.db, { id: "hidden-hash" });
    expect(result.current.slides.map((s) => s.image_hash)).toEqual(["hidden-hash"]);
    expect(result.current.atStart).toBe(true);
    expect(result.current.atEnd).toBe(true);
  });

  it("anchors on an unhashed camera-roll asset", async () => {
    await insertLocalAsset(t.db, { id: "L7", hash: null, createdAt: Date.UTC(2024, 0, 101) });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["L7"] });

    const { result } = await renderWindow(t.db, { id: "L7" });
    const centre = result.current.slides[result.current.restoreIndex ?? 0];
    expect(centre.local_id).toBe("L7");
    expect(centre.local_uri).toBe("ph://L7");
    expect(result.current.slides.length).toBeGreaterThan(1);
  });

  it("paints the seeded slide with no timeline row to stand on", async () => {
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
      const { result } = await renderWindow(empty.db, { id: "ph-1", seed });
      expect(result.current.slides).toEqual([seed]);
      expect(result.current.atStart).toBe(true);
      expect(result.current.atEnd).toBe(true);
    } finally {
      empty.close();
    }
  });
});
