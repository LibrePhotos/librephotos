// PATCH /api/photos/edit/{h}/ with exif_timestamp: the owner's datetime rules
// decide the capture time ("Timestamp set by user" first, then the file's
// EXIF, sidecars, file name...). Mutating: run with LP_TIMESTAMP=1 against ONE
// server on a fresh clone with its own media copy, then diff the database with
// the other server's clone (tests/README.md §4).
//
// Django reads the EXIF tags through the exif sidecar before applying any
// rule; the machine-wide one (port 8010) is not running here, so on Django
// this case needs a private exif sidecar (see the photo_edits report), or it
// answers 500 after storing `timestamp`.
import { describe, expect, it } from "vitest";

import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { photo } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { PhotoUpdateResponse } from "../../src/schemas/photo_edits";

const enabled = hasBase && process.env.LP_TIMESTAMP === "1";

const instant = (s: string | null | undefined) => (s ? new Date(s).getTime() : null);

async function patch(key: string, exifTimestamp: string | null) {
  const p = photo(key);
  const res = await call("alice", { method: "PATCH", path: `/api/photos/edit/${p.image_hash}/`, body: { exif_timestamp: exifTimestamp } });
  expect(res.status, res.text).toBe(200);
  return expectSchema(PhotoUpdateResponse, res.body);
}

describe.skipIf(!enabled)("PATCH exif_timestamp (datetime rules)", () => {
  it("a user-set time wins (naive = UTC)", async () => {
    const body = await patch("alice/e2e_03", "2001-02-03T04:05:06");
    expect(body.timestamp).toBe("2001-02-03T04:05:06Z");
    expect(body.exif_timestamp).toBe("2001-02-03T04:05:06Z");
  });

  it("an offset is converted to UTC", async () => {
    const body = await patch("alice/e2e_07", "2001-02-03T04:05:06+02:00");
    expect(body.exif_timestamp).toBe("2001-02-03T02:05:06Z");
  });

  it.each(["alice/e2e_04", "alice/xmp", "alice/burst_1", "alice/video", "alice/heic", "alice/berlin_01", "alice/screenshot"])(
    "clearing it falls back to the file: %s gets its scanned capture time back",
    async key => {
      const body = await patch(key, null);
      expect(body.timestamp).toBeNull();
      expect(instant(body.exif_timestamp)).toBe(instant(photo(key).exif_timestamp));
    },
  );

  it("no rule matches: no capture time", async () => {
    const body = await patch("alice/no_timestamp", null);
    expect(body.exif_timestamp).toBeNull();
  });
});
