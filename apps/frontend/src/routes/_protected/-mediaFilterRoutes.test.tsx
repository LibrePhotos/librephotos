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
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setUpMantineDom } from "../../components/modals/confirmModal.test-utils";
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
  // The site's trash retention in days (#2203); undefined: a server without the setting.
  retentionDays: undefined as number | undefined,
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
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => ({ data: { trash_retention_days: stubs.retentionDays } }),
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
  setUpMantineDom();
  await i18n.changeLanguage("en");
  // The cold import of the routes takes seconds, longer when the suite runs in parallel
  await Promise.all([import("./deleted"), import("./documents")]);
}, 30_000);

afterEach(() => {
  stubs.media = "all";
  stubs.retentionDays = undefined;
  stubs.listOptions = [];
  stubs.dayOptions = [];
});

/** The text a node the page hands to the list renders. */
async function textOf(node: React.ReactNode) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<MantineProvider>{node}</MantineProvider>);
  });
  // The provider adds its style tags: read the rendered paragraph.
  const text = container.querySelector("p")?.textContent;
  await act(async () => {
    root.unmount();
  });
  return text;
}

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

describe("the trash page's retention (#2203)", () => {
  it("says how long photos stay, in the subtitle and the empty state", async () => {
    stubs.retentionDays = 30;
    const props = await renderRoute("/_protected/deleted");

    expect(await textOf(props.additionalSubHeader)).toBe("Photos in the trash are deleted for good after 30 days.");
    expect(props.emptyStateConfig?.description).toBe(
      "Photos you move to the trash appear here. They are deleted for good after 30 days."
    );
    expect(props.headerActions).toBeTruthy();
  });

  it("says photos stay until emptied while the retention is off or unknown", async () => {
    for (const days of [0, undefined]) {
      stubs.retentionDays = days;
      const props = await renderRoute("/_protected/deleted");

      expect(await textOf(props.additionalSubHeader)).toBe("Photos stay in the trash until you empty it.");
      expect(props.emptyStateConfig?.description).toBe("Photos you move to the trash appear here until you empty it.");
    }
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
