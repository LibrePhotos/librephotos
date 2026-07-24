import { describe, expect, test } from "vitest";
import { z } from "zod";
import { MetadataHistoryResponse, Photo, PhotoMetadata, PhotoOcrData, Photoset } from "./types";

/**
 * Regression coverage for the PhotoMetadata zod schema drifting from the
 * backend serializer.
 *
 * `PhotoMetadataSerializer` (api/serializers/photo_metadata.py) serializes the
 * `PhotoMetadata` model, whose primary key is a `UUIDField` — so `id` is a UUID
 * string, not a number. The serializer also never emits `photo_id` (the photo is
 * addressed by the URL), nor `has_edits` (that field only exists on
 * `PhotoMetadataSummarySerializer`).
 *
 * The mismatch was masked because `useFetchPhotoMetadataQuery` cast the response
 * instead of parsing it, while `fetchPhotoMetadata` in metadata.ts parses. Both
 * paths now parse, so the schema has to match what the backend really sends.
 */

// A fully-populated response, as PhotoMetadataSerializer emits it.
const fullMetadata = {
  id: "3f2a9c1e-8b7d-4e5f-9a01-2b3c4d5e6f70",
  // Capture settings
  aperture: 2.8,
  shutter_speed: "1/250",
  shutter_speed_seconds: 0.004,
  iso: 400,
  focal_length: 35.0,
  focal_length_35mm: 52,
  exposure_compensation: -0.33,
  flash_fired: false,
  metering_mode: "Multi-segment",
  white_balance: "Auto",
  // Camera/lens info
  camera_make: "FUJIFILM",
  camera_model: "X-T4",
  lens_make: "FUJIFILM",
  lens_model: "XF35mmF1.4 R",
  serial_number: null,
  camera_display: "FUJIFILM X-T4",
  lens_display: "FUJIFILM XF35mmF1.4 R",
  // Image properties
  width: 6240,
  height: 4160,
  orientation: 1,
  color_space: "sRGB",
  bit_depth: 14,
  resolution: "6240x4160",
  megapixels: 26.0,
  // Timestamps
  date_taken: "2024-03-15T14:23:11Z",
  date_taken_subsec: "123",
  date_modified: "2024-03-15T14:25:02Z",
  timezone_offset: "+01:00",
  // Location
  gps_latitude: 48.137154,
  gps_longitude: 11.576124,
  gps_altitude: 519.0,
  location_country: "Germany",
  location_state: "Bavaria",
  location_city: "Munich",
  location_address: "Marienplatz 1, 80331 Munich",
  has_location: true,
  // Content
  title: "Marienplatz at dusk",
  caption: null,
  keywords: ["architecture", "munich"],
  rating: 4,
  copyright: null,
  creator: null,
  // Tracking
  source: "embedded",
  version: 3,
  created_at: "2024-03-16T09:00:00Z",
  updated_at: "2024-03-18T11:42:17Z",
  // Related
  edit_history: [
    {
      id: "b1d4e7a2-5c36-4f88-9e10-7a2b3c4d5e6f",
      field_name: "title",
      old_value: null,
      new_value: "Marienplatz at dusk",
      user: 1,
      user_name: "derneuere",
      synced_to_file: false,
      synced_at: null,
      created_at: "2024-03-18T11:42:17Z",
    },
  ],
  sidecar_files: [
    {
      id: "c9e8f7a6-1b2c-4d3e-8f90-a1b2c3d4e5f6",
      file_type: "xmp",
      source: "software",
      priority: 10,
      creator_software: "darktable",
      created_at: "2024-03-16T09:00:00Z",
      updated_at: "2024-03-16T09:00:00Z",
    },
  ],
};

// What the view returns for a photo that has never been scanned: the viewset's
// `_get_or_create_metadata` creates a near-empty row on the fly.
const freshMetadata = {
  ...fullMetadata,
  aperture: null,
  shutter_speed: null,
  shutter_speed_seconds: null,
  iso: null,
  focal_length: null,
  focal_length_35mm: null,
  exposure_compensation: null,
  flash_fired: null,
  metering_mode: null,
  white_balance: null,
  camera_make: null,
  camera_model: null,
  lens_make: null,
  lens_model: null,
  camera_display: null,
  lens_display: null,
  width: null,
  height: null,
  bit_depth: null,
  resolution: null,
  megapixels: null,
  date_taken: null,
  date_taken_subsec: null,
  date_modified: null,
  timezone_offset: null,
  gps_latitude: null,
  gps_longitude: null,
  gps_altitude: null,
  has_location: false,
  title: null,
  // keywords is a nullable JSONField, so an unpopulated row sends null (not [])
  keywords: null,
  rating: null,
  version: 1,
  edit_history: [],
  sidecar_files: [],
};

describe("PhotoMetadata schema vs. PhotoMetadataSerializer", () => {
  test("documents the symptom: the pre-fix id/photo_id declaration rejects the real payload", () => {
    // The schema used to declare `id: z.number()` and `photo_id: z.string().uuid()`.
    const preFix = z.object({ id: z.number(), photo_id: z.string().uuid() });

    const result = preFix.safeParse(fullMetadata);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join("."));
      // "Expected number, received string" at id; "Required" at photo_id.
      expect(paths).toEqual(expect.arrayContaining(["id", "photo_id"]));
    }
  });

  test("accepts the payload the serializer actually returns", () => {
    expect(() => PhotoMetadata.parse(fullMetadata)).not.toThrow();

    const parsed = PhotoMetadata.parse(fullMetadata);
    expect(parsed.id).toBe("3f2a9c1e-8b7d-4e5f-9a01-2b3c4d5e6f70");
    expect(parsed.camera_display).toBe("FUJIFILM X-T4");
    expect(parsed.keywords).toEqual(["architecture", "munich"]);
  });

  test("accepts the near-empty row the viewset creates for an unscanned photo", () => {
    expect(() => PhotoMetadata.parse(freshMetadata)).not.toThrow();
    expect(PhotoMetadata.parse(freshMetadata).keywords).toBeNull();
  });

  test("parses nested edit_history and sidecar_files, both keyed by UUID", () => {
    const parsed = PhotoMetadata.parse(fullMetadata);

    expect(parsed.edit_history).toHaveLength(1);
    expect(parsed.edit_history[0].id).toBe("b1d4e7a2-5c36-4f88-9e10-7a2b3c4d5e6f");
    expect(parsed.edit_history[0].user_name).toBe("derneuere");
    expect(parsed.edit_history[0].synced_at).toBeNull();

    expect(parsed.sidecar_files).toHaveLength(1);
    expect(parsed.sidecar_files[0].id).toBe("c9e8f7a6-1b2c-4d3e-8f90-a1b2c3d4e5f6");
    expect(parsed.sidecar_files[0].file_type).toBe("xmp");
    expect(parsed.sidecar_files[0].source).toBe("software");
  });

  test("rejects a numeric id, so the schema cannot silently drift back", () => {
    expect(PhotoMetadata.safeParse({ ...fullMetadata, id: 42 }).success).toBe(false);
  });

  test("does not carry has_edits — only the summary serializer has that flag", () => {
    // If the backend ever sent it, zod would strip it rather than expose it.
    const parsed = PhotoMetadata.parse({ ...fullMetadata, has_edits: true });
    expect(parsed).not.toHaveProperty("has_edits");
  });
});

describe("Screenshots media category", () => {
  test("exposes the screenshots Photoset backed by the 'screenshots' string", () => {
    expect(Photoset.SCREENSHOTS).toBe("screenshots");
  });

  test("Photo.is_screenshot defaults to false when the backend omits it", () => {
    const schema = Photo.pick({ video: true, is_screenshot: true });
    expect(schema.parse({ video: false })).toEqual({ video: false, is_screenshot: false });
  });

  test("Photo.is_screenshot round-trips a true value", () => {
    const schema = Photo.pick({ video: true, is_screenshot: true });
    expect(schema.parse({ video: false, is_screenshot: true }).is_screenshot).toBe(true);
  });
});

describe("Photo OCR (live text) schema", () => {
  // What PhotoSerializer.get_ocr emits for a photo with stored geometry.
  const ocrPayload = {
    text: "TOTAL 12.34",
    blocks: [
      {
        text: "TOTAL 12.34",
        box: [
          [0.1, 0.1],
          [0.6, 0.1],
          [0.6, 0.2],
          [0.1, 0.2],
        ],
        confidence: 0.95,
      },
    ],
  };

  test("accepts the serializer payload", () => {
    const parsed = PhotoOcrData.parse(ocrPayload);
    expect(parsed.blocks[0].box).toHaveLength(4);
    expect(parsed.blocks[0].box[1]).toEqual([0.6, 0.1]);
  });

  test("accepts a legacy row: text without blocks", () => {
    expect(PhotoOcrData.parse({ text: "legacy", blocks: [] }).blocks).toEqual([]);
  });

  test("rejects a box that is not a four-corner quad", () => {
    const flatBox = { text: "x", blocks: [{ text: "x", box: [0, 0, 10, 10], confidence: 0.9 }] };
    expect(PhotoOcrData.safeParse(flatBox).success).toBe(false);
  });

  test("Photo.ocr is optional (older backend) and nullable (no OCR row)", () => {
    const schema = Photo.pick({ video: true, ocr: true });
    expect(schema.parse({ video: false })).toEqual({ video: false });
    expect(schema.parse({ video: false, ocr: null }).ocr).toBeNull();
    expect(schema.parse({ video: false, ocr: ocrPayload }).ocr?.text).toBe("TOTAL 12.34");
  });
});

describe("MetadataHistoryResponse schema", () => {
  test("accepts the paginated envelope the history endpoint returns", () => {
    const payload = {
      results: fullMetadata.edit_history,
      count: 1,
      page: 1,
      page_size: 20,
    };

    expect(() => MetadataHistoryResponse.parse(payload)).not.toThrow();
    expect(MetadataHistoryResponse.parse(payload).results[0].field_name).toBe("title");
  });
});
