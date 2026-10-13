/**
 * The "Photos not in an album" page (#530): a flat paged list like No timestamp, whose select
 * all asks the server for every photo of the list (`no_album`, every stack member, the media
 * filter), and whose empty state points to My Albums.
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

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  requested: [] as Array<[number, MediaType]>,
  page: { count: 0, results: [] as PigPhoto[] },
  media: "all" as MediaType,
  props: undefined as PhotoListViewProps | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return {};
  },
}));
vi.mock("../../api_client/photos/hooks/useFetchPhotosNotInAlbumQuery", () => ({
  useFetchPhotosNotInAlbumQuery: (page: number, mediaType: MediaType) => {
    stubs.requested.push([page, mediaType]);
    // The same object on every render, like React Query's cached data.
    return { status: "success", data: stubs.page, isPlaceholderData: false };
  },
}));
vi.mock("../../components/photolist/useMediaTypeFilter", () => ({ useMediaTypeFilter: () => stubs.media }));
vi.mock("../../components/photolist/PhotoListView", () => ({
  PhotoListView: (props: PhotoListViewProps) => {
    stubs.props = props;
    return null;
  },
}));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  // The cold import of the route takes seconds, longer when the suite runs in parallel
  await import("./noalbum");
}, 30_000);

function setCount(count: number) {
  const results = Array.from({ length: Math.min(count, 100) }, (_unused, i): PigPhoto => ({
    ...tempPigPhoto(`p${i}`),
    isTemp: false,
  }));
  stubs.page = { count, results };
}

async function renderPage() {
  const NotInAlbum = defined(stubs.component);
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<NotInAlbum />);
  });
  return root;
}

describe("the not-in-an-album page", () => {
  it("lays out every photo of the list and selects all of them on the server", async () => {
    setCount(140);
    const root = await renderPage();
    const props = defined(stubs.props);

    expect(stubs.requested.at(-1)).toEqual([1, "all"]);
    expect(props.title).toBe("Photos not in an album");
    expect(props.photoset).toHaveLength(140);
    expect(props.photosetQuery).toEqual({ no_album: true, show_all_stack_photos: true });
    expect(props.emptyStateConfig?.title).toBe("Every photo is in an album");
    expect(props.emptyStateConfig?.actionLink).toBe("/album/user");

    await act(async () => {
      defined(props.updateItems)([tempPigPhoto("temp-120")]);
    });
    expect(stubs.requested.at(-1)).toEqual([2, "all"]);

    await act(async () => root.unmount());
  });

  it("sends the media filter to the list and to select all, without the empty state", async () => {
    setCount(0);
    stubs.media = "videos";
    const root = await renderPage();
    const props = defined(stubs.props);

    expect(stubs.requested.at(-1)).toEqual([1, "videos"]);
    expect(props.mediaType).toBe("videos");
    expect(props.photosetQuery).toEqual({ no_album: true, show_all_stack_photos: true, video: true });
    expect(props.emptyStateConfig).toBeUndefined();

    await act(async () => root.unmount());
    stubs.media = "all";
  });
});
