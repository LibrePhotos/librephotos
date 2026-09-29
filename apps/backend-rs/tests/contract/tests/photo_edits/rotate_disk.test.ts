// Rotation written to disk (write_orientation_to_disk), sent once to each
// server. Needs two fresh media-copy clones where alice's
// save_metadata_to_disk was set by SQL first: LP_ROTATE_DISK=media for
// MEDIA_FILE, LP_ROTATE_DISK=sidecar for SIDECAR_FILE. Then diff both
// databases and media trees with fixture/dump_state.py (files --content):
// the originals and sidecars must match byte for byte; only thumbnails differ
// (Django rebuilds them inline, Rust queues thumbnails.rerender).
import { describe, it } from "vitest";

import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { photo } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { RotatePhotosResponse } from "../../src/schemas/photo_edits";
import { expectTwin } from "../../src/twin";

const mode = hasBase ? process.env.LP_ROTATE_DISK : undefined;
const h = (key: string) => photo(key).image_hash;

async function rotate(key: string, angle: number, flip = false) {
  const req: Parameters<typeof call>[1] = {
    method: "POST",
    path: "/api/photosedit/rotate/",
    body: { image_hash: h(key), angle, flip_horizontal: flip },
  };
  const { actual } = await expectTwin("alice", req, { project: ["status", "image_hash", "local_orientation"], refStable: false });
  expectSchema(RotatePhotosResponse, actual.body);
}

describe.skipIf(mode !== "media")("rotate with save_metadata_to_disk = MEDIA_FILE", () => {
  it("folds into a JPEG, twice", async () => {
    await rotate("alice/e2e_06", 90);
    await rotate("alice/e2e_06", -90, true);
  });
  it("folds into a PNG", async () => {
    await rotate("alice/png", 180);
  });
  it("a HEIC cannot fold: the tag goes into the file, the turn stays in the DB", async () => {
    await rotate("alice/heic", 270);
  });
});

describe.skipIf(mode !== "sidecar")("rotate with save_metadata_to_disk = SIDECAR_FILE", () => {
  it("writes the XMP sidecar (EXIF tags do not land there) or nothing", async () => {
    await rotate("alice/xmp", 90);
    await rotate("alice/e2e_07", 90, true);
  });
});
