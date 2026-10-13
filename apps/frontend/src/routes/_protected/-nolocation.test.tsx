/**
 * The "no location" page lays out a placeholder per photo from the first page's count and
 * splices each page of 100 into its slots as the user scrolls to it.
 *
 * The query keeps the previous page's photos as placeholder data while the next one loads.
 * Those must not be spliced in at the new page's offset, or the list shows the previous page
 * twice until the real one lands.
 *
 * The media filter (?media=..., #2216) goes into the query, and a filter that matches nothing
 * does not claim the library has no photos without a location.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import type { MediaType, PigPhoto } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PhotoListView } from "../../components/photolist/PhotoListView";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { tempPigPhoto } from "../../util/util";

type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;
type PageResult = { data?: { count: number; results: PigPhoto[] }; isPlaceholderData: boolean };

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  pages: {} as Record<number, PageResult>,
  requestedPages: [] as number[],
  requestedMedia: [] as MediaType[],
  media: "all" as MediaType,
  props: undefined as PhotoListViewProps | undefined,
  photoset: [] as PigPhoto[],
  updateItems: undefined as PhotoListViewProps["updateItems"],
}));

/** The page hands PhotoListView one flat list of photos. */
function flatList(photoset: PhotoListViewProps["photoset"]): PigPhoto[] {
  return photoset.map(entry => {
    if ("items" in entry) throw new Error("the no-location page lists photos, not date groups");
    return entry;
  });
}

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return {};
  },
}));
vi.mock("../../api_client/photos/hooks/useFetchPhotosWithoutLocationQuery", () => ({
  useFetchPhotosWithoutLocationQuery: (page: number, mediaType: MediaType) => {
    stubs.requestedPages.push(page);
    stubs.requestedMedia.push(mediaType);
    return { status: "success", ...stubs.pages[page] };
  },
}));
vi.mock("../../components/photolist/useMediaTypeFilter", () => ({ useMediaTypeFilter: () => stubs.media }));
vi.mock("../../components/photolist/PhotoListView", () => ({
  PhotoListView: (props: PhotoListViewProps) => {
    stubs.photoset = flatList(props.photoset);
    stubs.updateItems = props.updateItems;
    stubs.props = props;
    return null;
  },
}));

const photos = (page: number) =>
  Array.from({ length: 100 }, (_unused, i): PigPhoto => ({ ...tempPigPhoto(`p${page}-${i}`), isTemp: false }));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  // The cold import of the route takes seconds, longer when the suite runs in parallel
  await import("./nolocation");
}, 30_000);

describe("the no-location page", () => {
  it("fills each page into its own slots and ignores the placeholder of the previous page", async () => {
    const page1 = { count: 250, results: photos(1) };
    stubs.pages = { 1: { data: page1, isPlaceholderData: false } };
    const NoLocation = defined(stubs.component);
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(<NoLocation />);
    });
    expect(stubs.photoset).toHaveLength(250);
    expect(defined(stubs.photoset[0]).id).toBe("p1-0");
    expect(defined(stubs.photoset[100]).isTemp).toBe(true);

    // Scrolling reaches the placeholders of page 2, which is still loading
    stubs.pages[2] = { data: page1, isPlaceholderData: true };
    await act(async () => {
      defined(stubs.updateItems)([tempPigPhoto("temp-150")]);
    });
    expect(stubs.requestedPages.at(-1)).toBe(2);
    expect(defined(stubs.photoset[100]).isTemp).toBe(true);
    expect(stubs.photoset.filter(photo => photo.id === "p1-0")).toHaveLength(1);

    // Page 2 arrives
    stubs.pages[2] = { data: { count: 250, results: photos(2) }, isPlaceholderData: false };
    await act(async () => {
      root.render(<NoLocation />);
    });
    expect(stubs.photoset).toHaveLength(250);
    expect(defined(stubs.photoset[0]).id).toBe("p1-0");
    expect(defined(stubs.photoset[100]).id).toBe("p2-0");
    expect(defined(stubs.photoset[199]).id).toBe("p2-99");
    expect(defined(stubs.photoset[200]).isTemp).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("asks for the media filter in the URL and drops the empty state while it filters", async () => {
    stubs.pages = { 1: { data: { count: 0, results: [] }, isPlaceholderData: false } };
    const NoLocation = defined(stubs.component);
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(<NoLocation />);
    });
    expect(stubs.requestedMedia.at(-1)).toBe("all");
    expect(stubs.props?.mediaType).toBe("all");
    expect(stubs.props?.emptyStateConfig).toBeDefined();

    stubs.media = "videos";
    await act(async () => {
      root.render(<NoLocation />);
    });
    expect(stubs.requestedMedia.at(-1)).toBe("videos");
    expect(stubs.props?.mediaType).toBe("videos");
    expect(stubs.props?.emptyStateConfig).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
    stubs.media = "all";
  });
});
