/**
 * The event page words its title in the UI language from the parts the backend stores (#2235),
 * and shows the stored English title for an event whose parts are not there yet.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import type { AutoAlbum, EventTitleParts } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoListView } from "../../../components/photolist/PhotoListView";
import i18n from "../../../i18n";

type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  album: undefined as AutoAlbum | undefined,
  listProps: undefined as PhotoListViewProps | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route = (options?: { component?: React.ComponentType }) => {
      stubs.component = options?.component;
      return route;
    };
    route.useParams = () => ({ id: "5" });
    return route;
  },
  Link: () => null,
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchAutoAlbumQuery: () => ({ data: stubs.album, isLoading: false, isError: false }),
}));
vi.mock("../../../components/AlbumLocationMap", () => ({ AlbumLocationMap: () => null }));
vi.mock("../../../components/photolist/PhotoListView", () => ({
  PhotoListView: (props: PhotoListViewProps) => {
    stubs.listProps = props;
    return null;
  },
}));

const PARTS: EventTitleParts = {
  weekday: 3,
  time_of_day: "afternoon",
  span_days: 0,
  weekend: false,
  people: ["Anna", "Ben"],
  places: ["Berlin"],
  date: "2025-03-12",
};

function event(title_parts: EventTitleParts | null): AutoAlbum {
  return {
    id: 5,
    title: "Wednesday Afternoon with Anna and Ben in Berlin",
    title_parts,
    favorited: false,
    timestamp: "2025-03-12T02:00:00Z",
    created_on: "2025-03-12T02:00:00Z",
    gps_lat: null,
    gps_lon: null,
    people: [],
    photos: [],
  };
}

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await import("./events.$id");
}, 30_000);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  stubs.listProps = undefined;
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

async function title(): Promise<PhotoListViewProps["title"]> {
  const Page = stubs.component;
  if (!Page) throw new Error("events.$id handed no component to createFileRoute");
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  await act(async () => root.unmount());
  if (!stubs.listProps) throw new Error("PhotoListView was not rendered");
  return stubs.listProps.title;
}

describe("the event page title", () => {
  it("reads like the stored title in English", async () => {
    stubs.album = event(PARTS);

    expect(await title()).toBe("Wednesday Afternoon with Anna and Ben in Berlin");
  });

  it("follows the UI language without asking the server again", async () => {
    stubs.album = event(PARTS);
    await i18n.changeLanguage("de");
    // Weblate owns the German strings; these stand in for them.
    i18n.addResourceBundle(
      "de",
      "translation",
      {
        autoalbum: {
          title: { afternoon: "{{weekday}}nachmittag", withPeopleInPlaces: "{{when}} mit {{people}} in {{places}}" },
        },
      },
      true,
      true
    );

    expect(await title()).toBe("Mittwochnachmittag mit Anna und Ben in Berlin");
  });

  it("keeps the stored title until the parts are generated", async () => {
    stubs.album = event(null);
    await i18n.changeLanguage("de");

    expect(await title()).toBe("Wednesday Afternoon with Anna and Ben in Berlin");
  });
});
