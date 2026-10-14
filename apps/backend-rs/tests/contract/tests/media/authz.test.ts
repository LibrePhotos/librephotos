/**
 * Media authorization matrix: every media kind of every fixture situation,
 * requested as each role, must get the reference's status and the headers
 * the browser / nginx act on (X-Media-Error, Content-Type, X-Accel-Redirect
 * or the direct-serving headers). Seeded from
 * apps/backend/api/tests/media_serving/test_unified_media_access_view.py,
 * test_thumbnail_serving_addressing.py and
 * sharing_and_public/test_media_access_authorization.py.
 *
 * Run once with both servers in x-accel mode and once with both in direct
 * mode; the mode is detected from the servers themselves.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { hasBase } from "../../src/env";
import { manifest, photo, type Role } from "../../src/manifest";
import { BASE_URL, DJANGO_500, REF_URL, mediaCases, mediaMode, type MediaMode } from "./_media";

import type { Pins } from "./_media";

// What Django must answer (pins the reference too, so a fixture or Django
// change is noticed). From the Django media tests' expectations.
function pins(): Record<string, Pins> {
  const m = manifest();
  const foreign = m.shares.album_shared_to_carol.foreign_photo;
  return {
    "alice/e2e_01 thumbnails_big": { alice: 200, bob: 404, carol: 404, dave: 404, admin: 404, anonymous: 403 },
    "alice/e2e_01 photos": { alice: 200, bob: 404, dave: 404, anonymous: 403 },
    "alice/e2e_01 thumbnails_big by uuid": { alice: 200, dave: 404, anonymous: 403 },
    "alice/e2e_01 photos by uuid (never accepted)": { alice: 404, anonymous: 403 },
    "alice/e2e_06 thumbnails_big": { alice: 200, bob: 200, carol: 200, dave: 404, anonymous: 403 },
    "alice/e2e_06 photos": { bob: 200, carol: 200, dave: 404 },
    "alice/e2e_07 thumbnails_big": { bob: 200, carol: 404 },
    "alice/e2e_05 thumbnails_big": { dave: 200, anonymous: 200 },
    "alice/e2e_05 photos": { dave: 200, anonymous: 200 },
    "alice/berlin_01 thumbnails_big": { anonymous: 200, carol: 200 },
    "alice/hidden thumbnails_big": { alice: 200, anonymous: 403, dave: 404 },
    "alice/trashed thumbnails_big": { alice: 200, anonymous: 403 },
    [`${foreign} thumbnails_big`]: { bob: 200, carol: 404, alice: 404, anonymous: 403 },
    [`${foreign} photos`]: { bob: 200, carol: 404, anonymous: 403 },
    "bob/e2e_01 thumbnails_big": { bob: 200, alice: 404 },
    "unknown hash": { alice: 404, anonymous: 403 },
    "unknown uuid": { alice: 404, anonymous: 403 },
    "zip by uuid": { anonymous: 403 },
    "zip, not a uuid": { alice: 404, anonymous: 403 },
    "zip, uuid plus digits": { alice: 404 },
    avatar: { anonymous: 403 },
    "alice/e2e_01 embedded_media": { alice: 404, anonymous: 404 },
    "photo share thumbnail": { anonymous: 200, dave: 200 },
    "photo share video of a still": { anonymous: 404 },
    "photo share, bad kind": { anonymous: 404 },
    "photo share, unknown slug": { anonymous: 404 },
  };
}

describe.skipIf(!hasBase)("authz: media", () => {
  let mode: MediaMode = "x-accel";
  beforeAll(async () => {
    mode = await mediaMode(BASE_URL);
    expect(await mediaMode(REF_URL)).toBe(mode);
  });

  // The case list depends on the mode only through the compared headers;
  // build it for both and pick at run time.
  const byMode = { "x-accel": mediaCases("x-accel"), direct: mediaCases("direct") };
  const pinned = pins();
  const names = byMode["x-accel"].map(c => c.name);

  it.each(names)("%s", async name => {
    const c: AuthzCase = { ...byMode[mode].find(x => x.name === name)!, expect: pinned[name] };
    const matrix = await authzMatrix([c]);
    const sane = DJANGO_500[name];
    if (sane) {
      // Django answers 500 here (see DJANGO_500); Rust gives the answer the
      // same request would get for a photo that does not exist.
      for (const cell of matrix[c.name]!) {
        if (sane[cell.role] === undefined) continue;
        expect(cell.ref, `${cell.role} on the reference`).toBe(500);
        expect(cell.actual, `${cell.role} on the server under test`).toBe(sane[cell.role]);
      }
      return;
    }
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });

  it("every pinned case exists", () => {
    for (const name of Object.keys(pinned)) expect(names).toContain(name);
    expect(photo("alice/e2e_01").image_hash).toBeTruthy();
  });
});
