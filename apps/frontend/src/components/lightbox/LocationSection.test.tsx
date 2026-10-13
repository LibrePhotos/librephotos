/**
 * #2253: a photo moved to a spot the geocoder could not name has coordinates
 * but no place name. The label said "No location yet" above the map with its
 * pin; it now names the spot by its coordinates.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { LocationSection } from "./LocationSection";

vi.mock("../LocationMap", () => ({ LocationMap: () => <div data-testid="map" /> }));
vi.mock("../map/LocationPickerModal", () => ({ LocationPickerModal: () => null }));

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

async function renderSection(photoDetail: React.ComponentProps<typeof LocationSection>["photoDetail"]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <LocationSection photoDetail={photoDetail} />
      </MantineProvider>
    );
  });
  return {
    text: container.textContent ?? "",
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

  it("says there is no location when there are no coordinates", async () => {
    const section = await renderSection({
      image_hash: "h1",
      exif_gps_lat: null,
      exif_gps_lon: null,
      search_location: "",
    });

    expect(section.text).toContain(i18n.t("lightbox.sidebar.no_location"));
    await section.unmount();
  });
});
