/**
 * The date-album pages that gained a media filter or a page of their own (#2215, #2216):
 * Trash and Documents. Trash takes ?media=..., hands it to the list and day queries, and
 * merges it into the select-all query, so "select all, delete permanently" reaches only
 * the photos on screen. Documents lists photos marked as documents, with its own empty
 * state.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import type { BulkPhotoQuery, MediaType } from "@librephotos/api-client";
import { Photoset } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PhotoListView } from "../../components/photolist/PhotoListView";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";

type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;
type RouteOptions = { component?: React.ComponentType; validateSearch?: (search: Record<string, unknown>) => unknown };
type ListOptions = { photosetType: Photoset; mediaType?: MediaType };

const stubs = vi.hoisted(() => ({
  routes: {} as Record<string, RouteOptions>,
  media: "all" as MediaType,
  listOptions: [] as ListOptions[],
  dayOptions: [] as ListOptions[],
  props: undefined as PhotoListViewProps | undefined,
  // One answer for every render: a new array each time would make the page lay out its photos forever.
  query: { data: [], isLoading: false, isError: false, isFetching: false, refetch: () => Promise.resolve() },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (options: RouteOptions) => {
    stubs.routes[path] = options;
    return {};
  },
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useFetchDateAlbumsQuery: (options: ListOptions) => {
    stubs.listOptions.push(options);
    return stubs.query;
  },
  useFetchDateAlbumQuery: (options: ListOptions) => {
    stubs.dayOptions.push(options);
  },
}));
vi.mock("../../components/photolist/useMediaTypeFilter", () => ({ useMediaTypeFilter: () => stubs.media }));
vi.mock("../../components/photolist/useScanEmptyStateAction", () => ({
  useScanEmptyStateAction: (description: string) => ({ description }),
}));
vi.mock("../../components/photolist/PhotoListView", () => ({
  PhotoListView: (props: PhotoListViewProps) => {
    stubs.props = props;
    return null;
  },
}));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  // The cold import of the routes takes seconds, longer when the suite runs in parallel
  await Promise.all([import("./deleted"), import("./documents")]);
}, 30_000);

afterEach(() => {
  stubs.media = "all";
  stubs.listOptions = [];
  stubs.dayOptions = [];
});

async function renderRoute(path: string) {
  const Page = defined(stubs.routes[path]?.component);
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Page />);
  });
  await act(async () => {
    root.unmount();
  });
  return defined(stubs.props);
}

describe("the trash page", () => {
  it("keeps the media filter in the URL", () => {
    const validateSearch = defined(stubs.routes["/_protected/deleted"]?.validateSearch);
    expect(validateSearch({ media: "videos" })).toEqual({ media: "videos" });
    expect(validateSearch({ media: "all" })).toEqual({});
  });

  it("filters the list, the day pages and select-all by the media filter", async () => {
    stubs.media = "videos";
    const props = await renderRoute("/_protected/deleted");

    expect(stubs.listOptions.at(-1)).toMatchObject({ photosetType: Photoset.IN_TRASHCAN, mediaType: "videos" });
    expect(stubs.dayOptions.at(-1)).toMatchObject({ photosetType: Photoset.IN_TRASHCAN, mediaType: "videos" });
    const query: BulkPhotoQuery | undefined = props.photosetQuery;
    expect(query).toEqual({ in_trashcan: true, video: true });
    expect(props.mediaType).toBe("videos");
    // "Trash is empty" would be wrong when only the filter matches nothing
    expect(props.emptyStateConfig).toBeUndefined();
  });

  it("shows the whole trash and its empty state without a filter", async () => {
    const props = await renderRoute("/_protected/deleted");

    expect(props.photosetQuery).toEqual({ in_trashcan: true });
    expect(props.mediaType).toBe("all");
    expect(props.emptyStateConfig?.title).toBe(i18n.t("emptystate.deleted.title"));
  });
});

describe("the documents page", () => {
  it("lists documents and selects only documents", async () => {
    const props = await renderRoute("/_protected/documents");

    expect(stubs.listOptions.at(-1)).toMatchObject({ photosetType: Photoset.DOCUMENTS });
    expect(props.photosetQuery).toEqual({ is_document: true });
    expect(props.title).toBe("Documents");
    expect(props.emptyStateConfig?.title).toBe("No documents yet");
    expect(props.emptyStateConfig?.description).toBe(i18n.t("emptystate.documents.description"));
  });
});
