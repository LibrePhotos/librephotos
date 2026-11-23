import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { PHOTO_DENSITY_SOURCE } from "./placesLayers";
import { PlacesPhotoMap } from "./PlacesPhotoMap";
import { usePlacesMap } from "./usePlacesMap";

type Children = Readonly<{ children?: React.ReactNode }>;
type SourceProps = Children & Readonly<{ id: string; cluster?: boolean }>;
type LayerProps = Readonly<{ id: string; layout?: Readonly<{ visibility?: string }> }>;

vi.mock("./ThemedMap", () => ({ ThemedMap: ({ children }: Children) => <div>{children}</div> }));
vi.mock("./SpotCard", () => ({ SpotCard: () => <div data-spot-card />, SpotRing: () => null }));
vi.mock("./SpotLightbox", () => ({ SpotLightbox: () => null }));
vi.mock("react-map-gl/maplibre", () => ({
  AttributionControl: () => null,
  NavigationControl: () => null,
  Marker: ({ children }: Children) => <div>{children}</div>,
  Source: ({ id, cluster, children }: SourceProps) => (
    <div data-source={id} data-cluster={String(cluster)}>
      {children}
    </div>
  ),
  Layer: ({ id, layout }: LayerProps) => <div data-layer={id} data-visibility={layout?.visibility} />,
}));

const SPOT = { longitude: 11.5, latitude: 48.1, bounds: { south: 48, west: 11, north: 49, east: 12 } };
const closeSpot = vi.fn<() => void>();

function Harness() {
  const placesMap = usePlacesMap(undefined, 400);
  return (
    <PlacesPhotoMap
      placesMap={{ ...placesMap, spot: SPOT, closeSpot }}
      mapStyle="https://tiles.example/style.json"
      height={400}
      onHeightChange={() => {}}
    />
  );
}

const layer = (id: string) => defined(document.body.querySelector(`[data-layer='${id}']`));
const visibility = (id: string) => layer(id).getAttribute("data-visibility");

async function choose(label: string) {
  const input = defined(
    [...document.body.querySelectorAll<HTMLInputElement>("input[type='radio']")].find(
      radio => radio.labels?.[0]?.textContent === label
    )
  );
  await act(async () => input.click());
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  closeSpot.mockReset();
});

describe("PlacesPhotoMap", () => {
  it("draws the heatmap from its own unclustered source, hidden while the clusters show", async () => {
    await renderInMantine(<Harness />);
    const density = layer("photo-heatmap").closest("[data-source]");

    expect(density?.getAttribute("data-source")).toBe(PHOTO_DENSITY_SOURCE);
    expect(density?.getAttribute("data-cluster")).toBe("false");
    expect(layer("clusters").closest("[data-source]")?.getAttribute("data-cluster")).toBe("true");
    expect(visibility("photo-heatmap")).toBe("none");
    expect(visibility("clusters")).toBe("visible");
  });

  it("switches to the heatmap, hides the clusters and closes the open spot", async () => {
    await renderInMantine(<Harness />);
    await choose("Heatmap");

    expect(visibility("photo-heatmap")).toBe("visible");
    expect(["clusters", "cluster-count", "unclustered-point"].map(visibility)).toEqual(["none", "none", "none"]);
    expect(closeSpot).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("lp:places.mapMode.v1")).toContain("heatmap");

    await choose("Clusters");
    expect(visibility("clusters")).toBe("visible");
    expect(closeSpot).toHaveBeenCalledTimes(1);
  });
});
