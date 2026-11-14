// photo_edits cases that change nothing: the one GET (share list) as contract
// + twin + authz, and every mutation endpoint called by someone who may not
// mutate (or with input that is rejected first), compared with the reference.
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { photo, user, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import {
  GenerateCaptionResponse,
  PhotoShareListResponse,
  PurgePhotosResponse,
  RotatePhotosResponse,
  SaveCaptionResponse,
  SharePhotosResponse,
  UpdatedPhotosResponse,
} from "../../src/schemas/photo_edits";
import { expectTwin } from "../../src/twin";

const e01 = photo("alice/e2e_01");
const e03 = photo("alice/e2e_03");
const trashed = photo("alice/trashed");
const hidden = photo("alice/hidden");
const shared = photo("alice/e2e_08");

const strangers: Role[] = ["bob", "carol", "dave", "admin"];

describe.skipIf(!hasBase)("GET /api/photo/share/list", () => {
  it("contract: alice's active links parse with the frontend schema", async () => {
    const res = await call("alice", { path: "/api/photo/share/list" });
    expect(res.status).toBe(200);
    const { results } = expectSchema(PhotoShareListResponse, res.body);
    expect(results.map(r => r.image_hash)).toEqual([shared.image_hash]);
    expect(results[0]!.url).toBe(`/public/p/${results[0]!.slug}`);
    expect(results[0]!.photo_id).toBe(shared.id);
  });

  it.each(["alice", "bob", "carol", "dave", "admin"] as const)("twin: %s", async role => {
    await expectTwin(role, { path: "/api/photo/share/list" }, { project: ["*"] });
  });

  it("authz: signed-in users only", async () => {
    const c: AuthzCase = { name: "share list", req: { path: "/api/photo/share/list" }, expect: { anonymous: 401, alice: 200 } };
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});

// Every request here is rejected or scoped to nothing for these roles, so
// the fixture is untouched. Status and the whole body must match Django.
interface NoopCase {
  name: string;
  roles: Role[];
  req: Parameters<typeof call>[1];
  schema?: { parse: (x: unknown) => unknown };
}

const noop: NoopCase[] = [
  ...(
    [
      ["favorite", { favorite: true }],
      ["hide", { hidden: true }],
      ["setdeleted", { deleted: true }],
      ["makepublic", { val_public: true }],
    ] as const
  ).map(([path, value]) => ({
    name: `${path} on alice's photos`,
    roles: [...strangers, "anonymous"] as Role[],
    req: { method: "POST" as const, path: `/api/photosedit/${path}/`, body: { image_hashes: [e01.image_hash, e03.image_hash], ...value } },
    schema: UpdatedPhotosResponse,
  })),
  {
    name: "share alice's photo onwards",
    roles: [...strangers, "anonymous"],
    req: {
      method: "POST",
      path: "/api/photosedit/share/",
      body: { image_hashes: [e01.image_hash], val_shared: true, target_user_id: user("dave").id },
    },
    schema: SharePhotosResponse,
  },
  {
    name: "purge alice's trashed photo",
    roles: [...strangers, "anonymous"],
    req: { method: "DELETE", path: "/api/photosedit/delete/", body: { image_hashes: [trashed.image_hash] } },
    schema: PurgePhotosResponse,
  },
  {
    name: "purge a photo that is not in the trash",
    roles: ["alice"],
    req: { method: "DELETE", path: "/api/photosedit/delete/", body: { image_hashes: [e01.image_hash, "unknown"] } },
    schema: PurgePhotosResponse,
  },
  {
    name: "rotate alice's photo",
    roles: [...strangers, "anonymous"],
    req: { method: "POST", path: "/api/photosedit/rotate/", body: { image_hash: e01.image_hash, angle: 90 } },
  },
  ...[
    { angle: 90 },
    { image_hash: e01.image_hash, angle: 45 },
    { image_hash: e01.image_hash, angle: "ninety" },
    { image_hash: photo("alice/video").image_hash, angle: 90 },
    { image_hash: e01.image_hash, angle: 0 },
  ].map((body, i) => ({
    name: `rotate rejected or no-op input #${i}`,
    roles: ["alice"] as Role[],
    req: { method: "POST" as const, path: "/api/photosedit/rotate/", body },
    schema: RotatePhotosResponse,
  })),
  {
    name: "save a caption on alice's photo",
    roles: [...strangers, "anonymous"],
    req: { method: "POST", path: "/api/photosedit/savecaption/", body: { image_hash: e01.image_hash, caption: "mine" } },
    schema: SaveCaptionResponse,
  },
  {
    name: "generate a caption (captioning is off on both)",
    roles: ["alice", "bob", "anonymous"],
    req: { method: "POST", path: "/api/photosedit/generateim2txt/", body: { image_hash: e01.image_hash } },
    schema: GenerateCaptionResponse,
  },
  {
    name: "PATCH alice's photo",
    roles: [...strangers, "anonymous"],
    req: { method: "PATCH", path: `/api/photos/edit/${e01.image_hash}/`, body: { exif_gps_lat: 1, exif_gps_lon: 2 } },
  },
  {
    name: "PATCH alice's photo by uuid",
    roles: ["bob", "anonymous"],
    req: { method: "PATCH", path: `/api/photos/edit/${e01.id}/`, body: { is_document: true } },
  },
  {
    name: "PATCH a hidden photo (not in Photo.visible)",
    roles: ["alice"],
    req: { method: "PATCH", path: `/api/photos/edit/${hidden.image_hash}/`, body: { is_document: true } },
  },
  {
    name: "PATCH with invalid values",
    roles: ["alice"],
    req: { method: "PATCH", path: `/api/photos/edit/${e01.image_hash}/`, body: { rating: "five", exif_gps_lat: "north" } },
  },
  {
    name: "PATCH errors come in serializer field order",
    roles: ["alice"],
    req: { method: "PATCH", path: `/api/photos/edit/${e03.image_hash}/`, body: { is_screenshot: "maybe", rating: 1.5, image_hash: true } },
  },
  ...[[1], "x", 5, 2.5, null, true].map((body, i) => ({
    name: `PATCH with a body that is not an object #${i}`,
    roles: ["alice"] as Role[],
    req: { method: "PATCH" as const, path: `/api/photos/edit/${e03.image_hash}/`, body },
  })),
  {
    name: "public link for alice's photo",
    roles: [...strangers, "anonymous"],
    req: { method: "POST", path: "/api/photo/share", body: { photo_id: e01.image_hash, action: "enable" } },
  },
  ...[{ action: "enable" }, { photo_id: e01.image_hash, action: "nuke" }, { photo_id: 5 }].map((body, i) => ({
    name: `public link rejected input #${i}`,
    roles: ["alice"] as Role[],
    req: { method: "POST" as const, path: "/api/photo/share", body },
  })),
];

describe.skipIf(!hasBase)("photo_edits: calls that must not change anything", () => {
  it.each(noop)("$name", async c => {
    for (const role of c.roles) {
      const { actual } = await expectTwin(role, c.req, { project: ["*"], refStable: false });
      if (c.schema && actual.status === 200) c.schema.parse(actual.body);
    }
  });
});
