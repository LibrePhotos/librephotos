/**
 * The Site settings card: it shows what the server stores and saves a switch at once.
 */
import type { SiteSettingsUpdate } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { SiteSettings } from "./SiteSettings";

const mocks = vi.hoisted(() => ({
  save: vi.fn<(input: SiteSettingsUpdate) => void>(),
  settingsQuery: {
    isLoading: false,
    dataUpdatedAt: 1,
    data: {
      allow_registration: false,
      allow_upload: true,
      skip_patterns: "@eaDir",
      map_api_key: "",
      map_api_provider: "nominatim",
      map_tile_provider: "photoprism",
      captioning_model: "lfm2_vl_450m",
      tagging_model: "openclip_vitb32",
      ocr_model: "None",
      face_recognition_model: "buffalo_sc",
      nextcloud_enabled: false,
      auto_create_user_directory: false,
    },
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => mocks.settingsQuery }));
vi.mock("./useSaveSiteSettings", () => ({ useSaveSiteSettings: () => mocks.save }));
// Its own test: TrashRetentionSetting.test.tsx.
vi.mock("./TrashRetentionSetting", () => ({ TrashRetentionSetting: () => null }));
vi.mock("./ScanSettings", () => ({
  LABEL_SPAN: { base: 12, sm: 8 },
  CONTROL_SPAN: { base: 12, sm: 4 },
  SkipPatternsSetting: () => null,
  MissingPhotosLimitSetting: () => null,
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
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
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  mocks.save.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <SiteSettings />
      </MantineProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  mocks.settingsQuery.data.map_api_provider = "nominatim";
});

/** Renders the card again as if the server stored ``provider`` as the Map Provider. */
async function renderWithMapProvider(provider: string) {
  mocks.settingsQuery.data.map_api_provider = provider;
  await act(async () => {
    root.render(
      <MantineProvider>
        <SiteSettings key={provider} />
      </MantineProvider>
    );
  });
}

function inputShowing(value: string): HTMLInputElement | undefined {
  return [...container.querySelectorAll<HTMLInputElement>("input")].find(input => input.value === value);
}

function switchLabelled(label: string): HTMLInputElement {
  const input = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    candidate => candidate.closest(".mantine-Switch-root")?.textContent?.includes(label) === true
  );
  return defined(input);
}

describe("SiteSettings", () => {
  it("shows the stored values", () => {
    expect(switchLabelled("sitesettings.headerupload").checked).toBe(true);
    expect(switchLabelled("sitesettings.header").checked).toBe(false);
  });

  it("saves a switch as soon as it is flipped", async () => {
    await act(async () => switchLabelled("sitesettings.headerupload").click());
    expect(mocks.save).toHaveBeenCalledWith({ allow_upload: false });
  });

  it("offers the offline ExifTool provider without an API key field", async () => {
    await renderWithMapProvider("exiftool");
    expect(inputShowing("sitesettings.option_offline")).toBeDefined();
    expect(container.textContent).not.toContain("sitesettings.map_api_key_header");
  });

  it("asks for an API key for a commercial provider", async () => {
    await renderWithMapProvider("mapbox");
    expect(inputShowing("Mapbox")).toBeDefined();
    expect(container.textContent).toContain("sitesettings.map_api_key_header");
  });

  it("renders the model settings without saving anything", () => {
    expect(container.textContent).toContain("sitesettings.ocr_model_header");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
