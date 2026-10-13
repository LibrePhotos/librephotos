/**
 * The missing photos limit (#2195) is a fraction on the server and a whole percent in the form.
 */
import type { SiteSettings } from "@librephotos/api-client";
import { Grid, MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { MissingPhotosLimitSetting } from "./ScanSettings";

const SETTINGS: SiteSettings = {
  allow_registration: false,
  allow_upload: true,
  skip_patterns: "",
  map_api_key: "",
  map_api_provider: "nominatim",
  map_tile_provider: "photoprism",
  captioning_model: "lfm2_vl_450m",
  tagging_model: "openclip_vitb32",
  ocr_model: "none",
  face_recognition_model: "buffalo_sc",
  nextcloud_enabled: false,
  auto_create_user_directory: false,
  scan_missing_max_fraction: 0.5,
};

const stubs = vi.hoisted(() => ({
  save: vi.fn<(input: Partial<SiteSettings>) => void>(),
  query: { data: undefined as SiteSettings | undefined, dataUpdatedAt: 1 },
}));
const save = stubs.save;

vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => stubs.query }));
vi.mock("./useSaveSiteSettings", () => ({ useSaveSiteSettings: () => stubs.save }));
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
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

const render = async () => {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <Grid>
          <MissingPhotosLimitSetting />
        </Grid>
      </MantineProvider>
    );
  });
};

beforeEach(async () => {
  save.mockReset();
  stubs.query = { data: SETTINGS, dataUpdatedAt: 1 };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const field = () => {
  const input = container.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error("the limit field is not rendered");
  return input;
};

const typeAndBlur = async (value: string) => {
  const input = field();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.focus();
    input.blur();
  });
};

describe("MissingPhotosLimitSetting", () => {
  it("shows the stored fraction as a percent", () => {
    expect(field().value).toBe("50%");
    expect(container.textContent).toContain(i18n.t("sitesettings.headerscanmissingmaxfraction"));
  });

  it("saves a new percent as a fraction", async () => {
    await typeAndBlur("80");

    expect(save).toHaveBeenCalledWith({ scan_missing_max_fraction: 0.8 });
  });

  it("does not save an unchanged value", async () => {
    await typeAndBlur("50");

    expect(save).not.toHaveBeenCalled();
  });

  it("puts the server's value back when the settings are reloaded", async () => {
    await typeAndBlur("80");
    // The save was refused; the same settings come back from a refetch.
    stubs.query = { data: SETTINGS, dataUpdatedAt: 2 };
    await render();

    expect(field().value).toBe("50%");
  });

  it("puts the stored value back when the field is emptied", async () => {
    await typeAndBlur("");

    expect(save).not.toHaveBeenCalled();
    expect(field().value).toBe("50%");
  });
});
