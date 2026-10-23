/**
 * The gallery's timeline (#434): the days of the photo list, every tile marked with whose photo it
 * is, the page of a day asked for once its placeholders are on screen (never a day of the timeline
 * of another filter), and an empty state that tells "nobody shows photos yet" from "nothing matches".
 */
import type { GalleryFilter, IncompleteDatePhotosGroup, PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { tempPigPhoto } from "../../util/util";
import { OwnerMarksContext } from "../photolist/ownerMarks";
import type { PigVisibleGroup } from "../photolist/PhotoListView";
import { GalleryTimeline } from "./GalleryTimeline";

type ListProps = {
  photoset: IncompleteDatePhotosGroup[];
  updateGroups: (groups: PigVisibleGroup<PigPhoto>[]) => void;
  isPublic: boolean;
  selectable: boolean;
};

const stubs = vi.hoisted(() => ({
  days: undefined as IncompleteDatePhotosGroup[] | undefined,
  error: null as Error | null,
  dayAsked: [] as [GalleryFilter, number, number][],
  list: undefined as ListProps | undefined,
  marked: false,
}));

vi.mock("../../api_client/gallery/hooks", () => ({
  useGalleryDaysQuery: () => ({
    data: stubs.days,
    error: stubs.error,
    isError: stubs.error !== null,
    isLoading: stubs.days === undefined && stubs.error === null,
    isFetching: false,
    refetch: async () => undefined,
  }),
  useGalleryDayQuery: (filter: GalleryFilter, day: number, page: number) => {
    stubs.dayAsked.push([filter, day, page]);
    return {};
  },
}));
vi.mock("../photolist/PhotoListView", () => ({
  PhotoListView: (props: ListProps) => {
    stubs.list = props;
    stubs.marked = useContext(OwnerMarksContext);
    return <div data-testid="photo-list" />;
  },
}));

beforeAll(async () => {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

let root: Root | undefined;
let container: HTMLDivElement;

const day = (id: number, count: number): IncompleteDatePhotosGroup => ({
  id,
  date: "2025-08-16",
  location: "",
  incomplete: true,
  numberOfItems: count,
  items: Array.from({ length: count }, (_, i) => tempPigPhoto(String(i))),
});

beforeEach(() => {
  stubs.days = [day(20250816, 150), day(1, 2)];
  stubs.error = null;
  stubs.dayAsked = [];
  stubs.list = undefined;
  stubs.marked = false;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

async function render(filter: GalleryFilter, filtered = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <GalleryTimeline filter={filter} filtered={filtered} />
      </MantineProvider>
    )
  );
}

describe("the gallery timeline", () => {
  it("shows the days read-only, every tile marked with whose photo it is", async () => {
    await render({});
    const list = defined(stubs.list);
    expect(list.photoset.map(group => group.id)).toEqual([20250816, 1]);
    expect(list.isPublic).toBe(true);
    expect(list.selectable).toBe(false);
    expect(stubs.marked).toBe(true);
    expect(stubs.dayAsked.at(-1)).toEqual([{}, 0, 1]);
  });

  it("asks for the page of a day whose placeholders are on screen", async () => {
    await render({ owner: 2 });
    const list = defined(stubs.list);
    const placeholders = Array.from({ length: 50 }, (_, i) => tempPigPhoto(String(100 + i)));
    await act(async () => list.updateGroups([{ id: 20250816, date: null, items: placeholders }]));
    expect(stubs.dayAsked.at(-1)).toEqual([{ owner: 2 }, 20250816, 2]);
  });

  it("does not ask the new filter for a day of the old timeline", async () => {
    await render({ owner: 2 });
    await act(async () => defined(stubs.list).updateGroups([{ id: 1, date: null, items: [tempPigPhoto("0")] }]));
    await act(async () =>
      defined(root).render(
        <MantineProvider env="test">
          <GalleryTimeline filter={{ owner: 3 }} filtered />
        </MantineProvider>
      )
    );
    expect(stubs.dayAsked.at(-1)).toEqual([{ owner: 3 }, 0, 1]);
  });

  it("tells an empty gallery from a filter that matches nothing", async () => {
    stubs.days = [];
    await render({});
    expect(container.textContent).toContain("No public photos yet");
    await act(async () => root?.unmount());
    container.remove();
    await render({ place: "Lisbon" }, true);
    expect(container.textContent).toContain("No public photos match this filter");
  });

  it("says when the timeline could not be loaded", async () => {
    stubs.days = undefined;
    stubs.error = new Error("network");
    await render({});
    expect(container.querySelector("[data-testid=photo-list]")).toBeNull();
  });
});
