/**
 * The person page (#2207): its title comes from the person itself, its header has the person's
 * menu, and an unknown person says so instead of "Loading" for good.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "../../../api_client/albums/hooks";
import type { PhotoListView } from "../../../components/photolist/PhotoListView";
import i18n from "../../../i18n";

type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  id: "5",
  person: undefined as Person | null | undefined,
  personLoading: false,
  personIds: [] as number[],
  listProps: undefined as PhotoListViewProps | undefined,
  // One object, like the query cache: a fresh one per render loops the route's effect that
  // flattens it.
  dateAlbums: { data: [], isLoading: false, isError: false, isFetching: false, refetch: async () => undefined },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route = (options?: { component?: React.ComponentType }) => {
      stubs.component = options?.component;
      return route;
    };
    route.useParams = () => ({ id: stubs.id });
    return route;
  },
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchPersonQuery: (id: number) => {
    stubs.personIds.push(id);
    return {
      data: stubs.person,
      isLoading: stubs.personLoading,
      isError: false,
      isFetching: false,
      refetch: async () => undefined,
    };
  },
  useFetchDateAlbumsQuery: () => stubs.dateAlbums,
  useFetchDateAlbumQuery: () => ({}),
}));
// The menu has its own test; here it only matters that the page passes it the person.
vi.mock("../../../components/album/PersonHeaderMenu", () => ({ PersonHeaderMenu: () => null }));
vi.mock("../../../components/photolist/PhotoListView", () => ({
  PhotoListView: (props: PhotoListViewProps) => {
    stubs.listProps = props;
    return null;
  },
}));
vi.mock("../../../components/photolist/useMediaTypeFilter", () => ({ useMediaTypeFilter: () => "all" }));
vi.mock("../../../components/photolist/mediaTypeFilter", () => ({
  validateMediaSearch: () => ({}),
  mediaTypeToBulkQuery: () => ({}),
}));

const anna: Person = {
  id: "5",
  name: "Anna Becker",
  video: false,
  face_count: 3,
  face_photo_url: "hash",
  face_url: "/media/faces/1.jpg",
  group_ids: [],
};

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  await import("./persons.$id");
}, 30_000);

beforeEach(() => {
  stubs.id = "5";
  stubs.person = anna;
  stubs.personLoading = false;
  stubs.personIds = [];
  stubs.listProps = undefined;
});

async function render(): Promise<PhotoListViewProps> {
  const Page = stubs.component;
  if (!Page) throw new Error("persons.$id handed no component to createFileRoute");
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  await act(async () => root.unmount());
  if (!stubs.listProps) throw new Error("PhotoListView was not rendered");
  return stubs.listProps;
}

describe("the person page", () => {
  it("loads the person by the id in the URL and shows the name with the person's menu", async () => {
    const props = await render();

    expect(stubs.personIds).toContain(5);
    expect(props.title).toBe("Anna Becker");
    const menu = props.headerActions;
    if (!React.isValidElement<{ person: Person }>(menu)) throw new Error("no person menu");
    expect(menu.props.person).toBe(anna);
    expect(props.emptyStateConfig).toBeUndefined();
    expect(props.mediaType).toBe("all");
  });

  it('leaves the title empty while the person loads, not "Loading"', async () => {
    stubs.person = undefined;
    stubs.personLoading = true;

    const props = await render();

    expect(props.title).toBe("");
    expect(props.loading).toBe(true);
    expect(props.headerActions).toBeUndefined();
  });

  it.each([
    ["an unknown person", "5", null],
    ["an id that is no number", "abc", undefined],
  ])("says the person is not found for %s", async (_name, id, person) => {
    stubs.id = id;
    stubs.person = person;

    const props = await render();

    expect(props.emptyStateConfig?.title).toBe("Person not found");
    expect(props.emptyStateConfig?.actionLink).toBe("/album/persons");
    expect(props.title).toBe("People");
    expect(props.headerActions).toBeUndefined();
    expect(props.mediaType).toBeUndefined();
  });
});
