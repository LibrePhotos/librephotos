import { describe, expect, test } from "vitest";
import { SiteSettings } from "./types";

const siteSettingsResponse = {
  allow_registration: false,
  allow_upload: true,
  skip_patterns: "",
  map_api_key: "",
  map_api_provider: "nominatim",
  map_tile_provider: "photoprism",
  captioning_model: "im2txt",
  llm_model: "None",
  tagging_model: "places365",
  ocr_model: "ppocrv6_small",
  face_recognition_model: "buffalo_sc",
  nextcloud_enabled: false,
};

describe("site settings schema", () => {
  test("the selected OCR model survives the parse", () => {
    const parsed = SiteSettings.parse(siteSettingsResponse);

    expect(parsed.ocr_model).toBe("ppocrv6_small");
  });

  test("a backend that predates OCR still yields usable settings", () => {
    const { ocr_model: _omitted, ...withoutOcr } = siteSettingsResponse;

    const parsed = SiteSettings.parse(withoutOcr);

    expect(parsed.ocr_model).toBe("none");
    expect(parsed.face_recognition_model).toBe("buffalo_sc");
  });
});
