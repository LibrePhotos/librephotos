/**
 * One of your places' page (#1365): its name, size, circle and photos, and for a place that is
 * not there (another user's, or deleted) the not-found state, while any other failure can be
 * retried.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import type { UserPlace } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../api_client/apiError";
import type { PhotoListView } from "../../../components/photolist/PhotoListView";
import i18n from "../../../i18n";

type PhotoListProps = Pick<
  React.ComponentProps<typeof PhotoListView>,
  "title" | "emptyStateConfig" | "error" | "additionalSubHeader" | "headerActions" | "banner"
>;
type Query = {
  data: { id: number; name: string; grouped_photos: never[] } | undefined;
  isLoading: boolean;
  error: Error | null;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
};
type Stubs = { component: React.ComponentType | undefined; query: Query; places: UserPlace[] };

const stubs = vi.hoisted((): Stubs => ({
  component: undefined,
  query: { data: undefined, isLoading: true, error: null, isError: false, isFetching: false, refetch: () => {} },
  places: [],
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    // The route module hands its page component to createFileRoute's options.
    const route = (options?: { component?: React.ComponentType }) => {
      stubs.component = options?.component;
      return route;
    };
    route.useParams = () => ({ id: "3" });
    return route;
  },
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useUserPlacePhotosQuery: () => stubs.query,
  useUserPlacesQuery: () => ({ data: stubs.places }),
}));
vi.mock("../../../components/places/YourPlaceActions", () => ({ YourPlaceActions: () => <span>actions</span> }));
vi.mock("../../../components/places/YourPlaceMap", () => ({ YourPlaceMap: () => <span>circle</span> }));
// PhotoListView drags in the whole grid; what it is handed is all that matters here.
vi.mock("../../../components/photolist/PhotoListView", () => ({
  PhotoListView: (props: PhotoListProps) => (
    <div>
      <h1>{props.title}</h1>
      {props.additionalSubHeader}
      {props.headerActions}
      {props.banner}
      {props.emptyStateConfig ? <p data-testid="empty">{props.emptyStateConfig.title}</p> : null}
      {props.error ? <p data-testid="error">failed</p> : null}
    </div>
  ),
}));
vi.mock("../../../components/photolist/useMediaTypeFilter", () => ({ useMediaTypeFilter: () => "all" }));
vi.mock("../../../components/photolist/mediaTypeFilter", () => ({ validateMediaSearch: () => ({}) }));

const home: UserPlace = {
  id: 3,
  name: "Home",
  icon: "home",
  center_lat: 48.1,
  center_lon: 11.5,
  radius_m: 150,
  use_in_titles: true,
  photo_count: 0,
  cover_photos: [],
};

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

async function renderPage(query: Partial<Query>, places: UserPlace[] = []) {
  stubs.query = { ...stubs.query, ...query };
  stubs.places = places;
  await import("./places.mine.$id");
  const Page = stubs.component;
  if (!Page) throw new Error("places.mine.$id handed no component to createFileRoute");
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <Page />
      </MantineProvider>
    );
  });
  return container;
}

describe("a place's page", () => {
  it("names the place, its size, its circle and its actions", async () => {
    const page = await renderPage(
      { data: { id: 3, name: "Home", grouped_photos: [] }, isLoading: false, error: null, isError: false },
      [home]
    );
    expect(page.querySelector("h1")?.textContent).toBe("Home");
    expect(page.textContent).toContain("Your place · 150 m around its centre");
    expect(page.textContent).toContain("actions");
    expect(page.textContent).toContain("circle");
  });

  it("says loading before the answer", async () => {
    const page = await renderPage({ data: undefined, isLoading: true, error: null, isError: false });
    expect(page.querySelector("h1")?.textContent).toBe(i18n.t("loading"));
  });

  it("shows the not-found state for a place that is not there", async () => {
    const page = await renderPage({
      data: undefined,
      isLoading: false,
      error: new ApiError("gone", 404),
      isError: true,
    });
    expect(page.querySelector("h1")?.textContent).toBe(i18n.t("places"));
    expect(page.querySelector('[data-testid="empty"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="error"]')).toBeNull();
  });

  it("offers a retry for any other failure", async () => {
    const page = await renderPage({
      data: undefined,
      isLoading: false,
      error: new ApiError("down", 503),
      isError: true,
    });
    expect(page.querySelector('[data-testid="error"]')).not.toBeNull();
  });
});
