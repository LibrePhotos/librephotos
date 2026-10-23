/**
 * #2253: a photo moved to a spot the geocoder could not name has coordinates
 * but no place name. The label said "No location yet" above the map with its
 * pin; it now names the spot by its coordinates. A photo at latitude or longitude 0 has a
 * map too (#2283).
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  // #1365: the owner's own place comes first, the map provider's name stays under it
  it("names the owner's place above the place name, and above bare coordinates", async () => {
    const named = await renderSection(
      { image_hash: "h1", exif_gps_lat: 48.1, exif_gps_lon: 11.5, search_location: "Marienplatz, Munich" },
      { yourPlace: { name: "Home", icon: "home" } }
    );
    expect(named.text.indexOf("Home")).toBeLessThan(named.text.indexOf("Marienplatz, Munich"));
    await named.unmount();

    const unnamed = await renderSection(
      { image_hash: "h1", exif_gps_lat: 48.1, exif_gps_lon: 11.5, search_location: "" },
      { yourPlace: { name: "Home", icon: "home" } }
    );
    expect(unnamed.text).toContain("Home");
    expect(unnamed.text).toContain("48.10000, 11.50000");
    await unnamed.unmount();
  });

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

  describe("the owner's coordinates (#2276)", () => {
    const copyLabel = () => i18n.t("exif.copycoordinates");
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});

    beforeEach(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    });

    afterEach(() => {
      Reflect.deleteProperty(navigator, "clipboard");
      writeText.mockClear();
    });

    it("are under the place name, with a copy button and the altitude", async () => {
      const section = await renderSection({
        image_hash: "h1",
        exif_gps_lat: 37.0899,
        exif_gps_lon: -8.4128,
        search_location: "Praia da Marinha",
        gps_altitude: -4,
      });

      expect(section.text).toContain("Praia da Marinha");
      expect(section.text).toContain("37.08990, -8.41280");
      expect(section.text).toContain("4 m below sea level");
      const copy = section.container.querySelector<HTMLButtonElement>(`[aria-label="${copyLabel()}"]`);
      await act(async () => copy?.click());
      expect(writeText).toHaveBeenCalledWith("37.08990, -8.41280");
      await section.unmount();
    });

    it("copy as maps take them in a German UI too", async () => {
      await i18n.changeLanguage("de");
      try {
        const section = await renderSection({
          image_hash: "h1",
          exif_gps_lat: 37.0899,
          exif_gps_lon: -8.4128,
          search_location: "Praia da Marinha",
        });
        expect(section.text).toContain("37,08990; -8,41280");
        await act(async () =>
          section.container.querySelector<HTMLButtonElement>(`[aria-label="${copyLabel()}"]`)?.click()
        );
        expect(writeText).toHaveBeenCalledWith("37.08990, -8.41280");
        await section.unmount();
      } finally {
        await i18n.changeLanguage("en");
      }
    });

    it("are the label, once, where the place has no name", async () => {
      const section = await renderSection({ image_hash: "h1", exif_gps_lat: 36.5, exif_gps_lon: -6.3 });

      expect(section.text.split("36.50000, -6.30000")).toHaveLength(2);
      expect(section.container.querySelector(`[aria-label="${copyLabel()}"]`)).not.toBeNull();
      await section.unmount();
    });

    it("are not offered to a visitor", async () => {
      const section = await renderSection(
        { image_hash: "h1", exif_gps_lat: 37.0899, exif_gps_lon: -8.4128, search_location: "Praia", gps_altitude: 31 },
        { isPublic: true }
      );

      expect(section.text).not.toContain("37.08990");
      expect(section.text).not.toContain("sea level");
      expect(section.container.querySelector(`[aria-label="${copyLabel()}"]`)).toBeNull();
      await section.unmount();
    });

    it("have no copy button where the browser has no clipboard (plain HTTP)", async () => {
      Reflect.deleteProperty(navigator, "clipboard");
      const section = await renderSection({ image_hash: "h1", exif_gps_lat: 1, exif_gps_lon: 2, search_location: "X" });

      expect(section.text).toContain("1.00000, 2.00000");
      expect(section.container.querySelector(`[aria-label="${copyLabel()}"]`)).toBeNull();
      await section.unmount();
    });
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
