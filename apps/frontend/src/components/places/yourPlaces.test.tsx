/**
 * Your places (#1365) on the Places page: the row above the grid, the circles and names on the
 * map, the live count of the editor, and a place page's Edit and Delete.
 */
import type { UserPlace, UserPlacePreview } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { PlacePreview } from "./PlacePreview";
import { renderPlaces } from "./renderPlaces.test-utils";
import { YourPlaceActions } from "./YourPlaceActions";
import { YourPlacesLayer } from "./YourPlacesLayer";
import { YourPlacesRow } from "./YourPlacesRow";

type Stubs = { navigated: unknown[]; deleted: unknown[] };
const stubs = vi.hoisted((): Stubs => ({ navigated: [], deleted: [] }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => (options: unknown) => {
    stubs.navigated.push(options);
    return Promise.resolve();
  },
  Link: ({ children, to, params }: { children?: React.ReactNode; to: string; params?: { id: string } }) => (
    <a href={to.replace("$id", params?.id ?? "")}>{children}</a>
  ),
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useDeleteUserPlaceMutation: () => ({
    isPending: false,
    mutate: (params: unknown, options: { onSuccess?: () => void }) => {
      stubs.deleted.push(params);
      options.onSuccess?.();
    },
  }),
}));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
// The map's pieces as plain elements: a draggable marker drags to (1, 2) when clicked
vi.mock("react-map-gl/maplibre", () => ({
  Source: ({ children }: { children?: React.ReactNode }) => <div data-testid="source">{children}</div>,
  Layer: ({ id }: { id: string }) => <span data-layer={id} />,
  Marker: ({
    children,
    draggable,
    onDrag,
  }: {
    children?: React.ReactNode;
    draggable?: boolean;
    onDrag?: (event: { lngLat: { lat: number; lng: number } }) => void;
  }) => (
    <div data-draggable={draggable ? "yes" : undefined} onClick={() => onDrag?.({ lngLat: { lat: 1, lng: 2 } })}>
      {children}
    </div>
  ),
}));

const place = (id: number, name: string, photoCount = 2): UserPlace => ({
  id,
  name,
  icon: "home",
  center_lat: 48.1,
  center_lon: 11.5,
  radius_m: 150,
  use_in_titles: true,
  photo_count: photoCount,
  cover_photos: photoCount ? [{ image_hash: `cover-${id}`, video: false }] : [],
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.navigated = [];
  stubs.deleted = [];
});

describe("YourPlacesRow", () => {
  it("lists every place with its count and size, and adds one", async () => {
    const onAdd = vi.fn<() => void>();
    const row = await renderPlaces(
      <YourPlacesRow places={[place(1, "Home"), place(2, "Gym", 0)]} addDisabledReason={null} onAdd={onAdd} />
    );
    expect(row.text()).toContain("2 photos · 150 m");
    expect(row.text()).toContain("0 photos · 150 m");
    expect(row.container.querySelector('a[href="/album/places/mine/1"]')).not.toBeNull();
    await row.click(row.button("Add place"));
    expect(onAdd).toHaveBeenCalled();
    await row.unmount();
  });

  it("says why a place cannot be added", async () => {
    const onAdd = vi.fn<() => void>();
    const row = await renderPlaces(
      <YourPlacesRow places={[place(1, "Home")]} addDisabledReason="Maps are off" onAdd={onAdd} />
    );
    await row.click(row.button("Add place"));
    expect(onAdd).not.toHaveBeenCalled();
    await row.unmount();
  });
});

describe("YourPlacesLayer", () => {
  it("draws each place with its name, which opens it", async () => {
    const onOpenPlace = vi.fn<(place: UserPlace) => void>();
    const home = place(1, "Home");
    const layer = await renderPlaces(
      <YourPlacesLayer places={[home]} editor={null} onEdgeDrag={() => {}} onOpenPlace={onOpenPlace} />
    );
    expect(layer.container.querySelector('[data-layer="your-places-line"]')).not.toBeNull();
    expect(layer.container.querySelector('[data-layer="place-draft-line"]')).toBeNull();
    await layer.click(layer.button("Home"));
    expect(onOpenPlace).toHaveBeenCalledWith(home);
    await layer.unmount();
  });

  it("while a place is drawn: its circle and edge handle, the others dimmed", async () => {
    const onOpenPlace = vi.fn<(place: UserPlace) => void>();
    const onEdgeDrag = vi.fn<(edge: { lat: number; lon: number }) => void>();
    const editor = {
      id: 1,
      center: { lat: 48.1, lon: 11.5 },
      radiusM: 150,
      name: "Home",
      icon: "home" as const,
      useInTitles: true,
    };
    const layer = await renderPlaces(
      <YourPlacesLayer
        places={[place(1, "Home"), place(2, "Gym")]}
        editor={editor}
        onEdgeDrag={onEdgeDrag}
        onOpenPlace={onOpenPlace}
      />
    );
    // The place being edited is the draft, not a labelled circle
    expect(layer.button("Home")).toBeUndefined();
    expect(layer.container.querySelector('[data-layer="place-draft-line"]')).not.toBeNull();
    await layer.click(layer.button("Gym"));
    expect(onOpenPlace).not.toHaveBeenCalled();
    await layer.click(layer.container.querySelector<HTMLElement>('[data-draggable="yes"]') ?? undefined);
    expect(onEdgeDrag).toHaveBeenCalledWith({ lat: 1, lon: 2 });
    await layer.unmount();
  });
});

describe("PlacePreview", () => {
  const query = (data: UserPlacePreview | undefined, isError = false) => ({ data, isFetching: false, isError });

  it("counts, then names the places that share photos", async () => {
    const preview = await renderPlaces(
      <PlacePreview
        query={query({
          photo_count: 5,
          cover_photos: [{ image_hash: "h1", video: false }],
          overlaps: [
            { id: 2, name: "Office", photo_count: 1, smaller: true },
            { id: 3, name: "Town", photo_count: 4, smaller: false },
          ],
        })}
      />
    );
    expect(preview.text()).toContain("5 photos were taken inside");
    expect(preview.text()).toContain("1 photo is inside Office too. It shows Office, the smaller place.");
    expect(preview.text()).toContain("4 photos are inside Town too. They show this place, the smaller one.");
    await preview.unmount();
  });

  it("says it is counting, or that it could not", async () => {
    const counting = await renderPlaces(<PlacePreview query={query(undefined)} />);
    expect(counting.text()).toContain(i18n.t("yourplaces.preview.counting"));
    await counting.unmount();
    const failed = await renderPlaces(<PlacePreview query={query(undefined, true)} />);
    expect(failed.text()).toContain(i18n.t("yourplaces.preview.failed"));
    await failed.unmount();
  });
});

describe("YourPlaceActions", () => {
  it("opens the editor on the Places map", async () => {
    const actions = await renderPlaces(<YourPlaceActions place={place(4, "Home")} />);
    await actions.click(actions.button("Edit place"));
    expect(stubs.navigated).toEqual([{ to: "/album/places", search: { edit: 4 } }]);
    await actions.unmount();
  });

  it("deletes the place after asking, and goes back to Places", async () => {
    const actions = await renderPlaces(<YourPlaceActions place={place(4, "Home", 3)} />);
    await actions.click(actions.button(i18n.t("moreactions")));
    await actions.click(
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        item => item.textContent === "Delete place"
      )
    );
    expect(document.body.textContent).toContain("The 3 photos in Home stay in your library");
    await actions.click(
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
        button => button.textContent === "Delete place"
      )
    );
    expect(stubs.deleted).toEqual([{ id: 4, name: "Home" }]);
    expect(stubs.navigated).toEqual([{ to: "/album/places" }]);
    await actions.unmount();
  });
});
