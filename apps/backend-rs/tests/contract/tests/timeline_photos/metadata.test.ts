// GET / PATCH /photos/{id}/metadata (fetchPhotoMetadata / updatePhotoMetadata
// parse both with PhotoMetadata).
import { PhotoMetadata } from "@fe/photos/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase, REF_URL } from "../../src/env";
import { manifest, photo } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

// Everything but the ids of rows a GET may have created and the timestamps
// that record when; the edit history is projected field by field.
const METADATA = [
  "aperture",
  "shutter_speed",
  "shutter_speed_seconds",
  "iso",
  "focal_length",
  "focal_length_35mm",
  "exposure_compensation",
  "flash_fired",
  "metering_mode",
  "white_balance",
  "camera_make",
  "camera_model",
  "lens_make",
  "lens_model",
  "serial_number",
  "camera_display",
  "lens_display",
  "width",
  "height",
  "orientation",
  "color_space",
  "bit_depth",
  "resolution",
  "megapixels",
  "date_taken",
  "date_taken_subsec",
  "date_modified",
  "timezone_offset",
  "gps_latitude",
  "gps_longitude",
  "gps_altitude",
  "location_country",
  "location_state",
  "location_city",
  "location_address",
  "has_location",
  "title",
  "caption",
  "keywords",
  "rating",
  "copyright",
  "creator",
  "source",
  "version",
  "edit_history[].field_name",
  "edit_history[].old_value",
  "edit_history[].new_value",
  "edit_history[].user",
  "edit_history[].user_name",
  "edit_history[].synced_to_file",
  "sidecar_files[].file_type",
  "sidecar_files[].source",
  "sidecar_files[].priority",
];

describe.skipIf(!hasBase)("timeline_photos: GET /api/photos/{id}/metadata", () => {
  it("contract: every photo's metadata parses for its owner", async () => {
    for (const [key, p] of Object.entries(manifest().photos)) {
      for (const id of [p.id, p.image_hash]) {
        const res = await call(p.owner, { path: `/api/photos/${id}/metadata` });
        expect(res.status, key).toBe(200);
        expectSchema(PhotoMetadata, res.body, key);
      }
    }
  });

  it("twin: owner, staff, strangers", async () => {
    for (const p of Object.values(manifest().photos)) {
      for (const role of [p.owner, "admin", "dave"] as const) {
        await expectTwin(role, { path: `/api/photos/${p.id}/metadata` }, { project: ["id", ...METADATA], refStable: false });
      }
    }
    for (const key of ["abc", "00000000-0000-0000-0000-000000000000"]) {
      await expectTwin("alice", { path: `/api/photos/${key}/metadata` }, { project: [] });
    }
    // Outside Django's URL pattern: its HTML 404 page; only the status can match.
    const ref = await call("alice", { path: "/api/photos/NOTHEX/metadata" }, REF_URL);
    const actual = await call("alice", { path: "/api/photos/NOTHEX/metadata" });
    expect([ref.status, actual.status]).toEqual([404, 404]);
  });
});

describe.skipIf(!hasBase)("timeline_photos: PATCH /api/photos/{id}/metadata", () => {
  // Changes state: both servers get the same requests in the same order, so
  // they stay in step on their twin clones (versions keep increasing together).
  const target = photo("alice/e2e_03");
  const path = `/api/photos/${target.id}/metadata`;

  it("twin + contract: an edit, a keyword change, a no-op", async () => {
    for (const body of [
      { title: "  Twin title  ", caption: "cap", rating: 3, keywords: ["twin-kw-1", "twin-kw-2"] },
      { keywords: ["twin-kw-2"], title: "Twin title" },
      { rating: "3.0", creator: null },
    ]) {
      const { actual } = await expectTwin(
        "alice",
        { method: "PATCH", path, body },
        { project: METADATA, refStable: false },
      );
      expectSchema(PhotoMetadata, actual.body);
    }
  });

  it("twin: validation errors", async () => {
    for (const body of [
      { rating: "x" },
      { rating: 4.5, title: "y".repeat(501) },
      { gps_latitude: "north" },
      { date_taken: "yesterday" },
      { title: true },
    ]) {
      await expectTwin("alice", { method: "PATCH", path, body }, { project: ["*"], refStable: false });
    }
  });

  it("twin: someone else's photo", async () => {
    await expectTwin("bob", { method: "PATCH", path, body: { title: "nope" } }, { project: [], refStable: false });
  });
});

describe.skipIf(!hasBase)("timeline_photos: authz metadata", () => {
  const p = photo("alice/e2e_01");
  const cases: AuthzCase[] = [
    { name: "GET own", req: { path: `/api/photos/${p.id}/metadata` }, expect: { alice: 200, admin: 200, bob: 404, anonymous: 401 } },
    { name: "GET by hash", req: { path: `/api/photos/${p.image_hash}/metadata` } },
  ];
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
