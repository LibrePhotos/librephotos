/**
 * #2253: a photo moved to a spot the geocoder could not name has coordinates
 * but no place name. The label said "No location yet" above the map with its
 * pin; it now names the spot by its coordinates. A photo at latitude or longitude 0 has a
 * map too (#2283).
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { LocationSection } from "./LocationSection";

vi.mock("../LocationMap", () => ({ LocationMap: () => <div data-testid="map" /> }));
vi.mock("../map/LocationPickerModal", () => ({ LocationPickerModal: () => <div data-testid="picker" /> }));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
  await i18n.changeLanguage("en");
});

async function renderSection(
  photoDetail: React.ComponentProps<typeof LocationSection>["photoDetail"],
  props: Partial<React.ComponentProps<typeof LocationSection>> = {}
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <LocationSection photoDetail={photoDetail} {...props} />
      </MantineProvider>
    );
  });
  return {
    text: container.textContent ?? "",
    hasMap: container.querySelector('[data-testid="map"]') !== null,
    container,
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("LocationSection", () => {
  it("names a spot without a place name by its coordinates", async () => {
    const section = await renderSection({
      image_hash: "h1",
      exif_gps_lat: 36.5,
      exif_gps_lon: -6.3,
      search_location: "",
    });

    expect(section.text).toContain("36.50000, -6.30000");
    expect(section.text).not.toContain(i18n.t("lightbox.sidebar.no_location"));
    await section.unmount();
  });

  it("shows the place name when there is one", async () => {
    const section = await renderSection({
      image_hash: "h1",
      exif_gps_lat: 40.4,
      exif_gps_lon: -3.7,
      search_location: "Madrid, Spain",
    });

    expect(section.text).toContain("Madrid, Spain");
    await section.unmount();
  });

  it.each([
    [0, 13.4],
    [52.5, 0],
    [0, 0],
  ])("shows the map of a photo at %f, %f (#2283)", async (lat, lon) => {
    const section = await renderSection({ image_hash: "h1", exif_gps_lat: lat, exif_gps_lon: lon });

    expect(section.hasMap).toBe(true);
    await section.unmount();
  });

  it("says there is no location when there are no coordinates", async () => {
    const section = await renderSection({
      image_hash: "h1",
      exif_gps_lat: null,
      exif_gps_lon: null,
      search_location: "",
    });

    expect(section.text).toContain(i18n.t("lightbox.sidebar.no_location"));
    expect(section.hasMap).toBe(false);
    await section.unmount();
  });

  it("shows a card's heading in place of its own, next to the pencil", async () => {
    const section = await renderSection(
      { image_hash: "h1", exif_gps_lat: null, exif_gps_lon: null, search_location: "Madrid, Spain" },
      { heading: <h2>Place card</h2> }
    );

    expect(section.container.querySelector("h2")?.textContent).toBe("Place card");
    expect(section.text).toContain("Madrid, Spain");
    expect(
      section.container.querySelector(`[aria-label="${i18n.t("lightbox.sidebar.update_location")}"]`)
    ).not.toBeNull();
    await section.unmount();
  });

  it("opens the location picker at once when asked to", async () => {
    const section = await renderSection(
      { image_hash: "h1", exif_gps_lat: null, exif_gps_lon: null, search_location: "" },
      { startEditing: true }
    );

    expect(document.querySelector('[data-testid="picker"]')).not.toBeNull();
    await section.unmount();
  });
});
