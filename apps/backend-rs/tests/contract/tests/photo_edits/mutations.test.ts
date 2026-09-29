// photo_edits mutations, sent once to each server. Run ONLY against two fresh
// clones with their own media copies (LP_MUTATION=1), then diff the databases
// and media trees with fixture/dump_state.py (see tests/README.md §4).
//
// Not here: PATCH exif_timestamp. Django's extract_date_time reads EXIF
// through the exif sidecar on the machine-wide port 8010 before applying any
// rule, and answers 500 without it; see timestamp.test.ts.
import { describe, expect, it } from "vitest";

import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { photo, user } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import {
  DeletePhotosResponse,
  PhotoShareResponse,
  PhotoUpdateResponse,
  PurgePhotosResponse,
  RotatePhotosResponse,
  SaveCaptionResponse,
  SharePhotosResponse,
  UpdatedPhotosResponse,
} from "../../src/schemas/photo_edits";
import { expectTwin } from "../../src/twin";

const enabled = hasBase && process.env.LP_MUTATION === "1";
const h = (key: string) => photo(key).image_hash;

type Req = Parameters<typeof call>[1];
const post = (path: string, body: unknown): Req => ({ method: "POST", path, body });

async function step(req: Req, schema: { parse: (x: unknown) => unknown } | null, project = ["*"]) {
  const { actual } = await expectTwin("alice", req, { project, refStable: false });
  if (schema) expectSchema(schema as never, actual.body);
  return actual;
}

describe.skipIf(!enabled)("photo_edits mutations (twin, one pass)", () => {
  it("favorite: hashes, then select_all", async () => {
    await step(post("/api/photosedit/favorite/", { image_hashes: [h("alice/e2e_03"), h("alice/e2e_01")], favorite: true }), UpdatedPhotosResponse);
    await step(
      post("/api/photosedit/favorite/", {
        select_all: true,
        query: { favorite: true },
        excluded_hashes: [h("alice/e2e_01")],
        favorite: false,
      }),
      UpdatedPhotosResponse,
    );
  });

  it("hide: hashes and select_all (tag counts)", async () => {
    await step(post("/api/photosedit/hide/", { image_hashes: [h("alice/e2e_04"), h("alice/berlin_02")], hidden: true }), UpdatedPhotosResponse);
    await step(post("/api/photosedit/hide/", { select_all: true, query: { video: true }, hidden: true }), UpdatedPhotosResponse);
  });

  it("setdeleted: trash, restore (stack reviews), trash more", async () => {
    await step(post("/api/photosedit/setdeleted/", { image_hashes: [h("alice/burst_2")], deleted: true }), DeletePhotosResponse);
    await step(post("/api/photosedit/setdeleted/", { image_hashes: [h("alice/burst_2")], deleted: false }), DeletePhotosResponse);
    await step(
      post("/api/photosedit/setdeleted/", { image_hashes: [h("alice/e2e_02"), h("alice/dup_resized"), h("alice/manual_b")], deleted: true }),
      DeletePhotosResponse,
    );
  });

  it("makepublic", async () => {
    await step(post("/api/photosedit/makepublic/", { image_hashes: [h("alice/e2e_03")], val_public: true }), UpdatedPhotosResponse);
    await step(post("/api/photosedit/makepublic/", { select_all: true, query: { public: true }, excluded_hashes: [h("alice/e2e_03")], val_public: false }), UpdatedPhotosResponse);
  });

  it("share to users", async () => {
    await step(
      post("/api/photosedit/share/", { image_hashes: [h("alice/e2e_07"), h("alice/e2e_03")], val_shared: true, target_user_id: user("carol").id }),
      SharePhotosResponse,
    );
    await step(post("/api/photosedit/share/", { select_all: true, query: {}, val_shared: false, target_user_id: user("bob").id }), SharePhotosResponse);
  });

  it("captions and hashtag albums", async () => {
    await step(post("/api/photosedit/savecaption/", { image_hash: h("alice/e2e_05"), caption: "<start>Lake day #summer #lake<end>" }), SaveCaptionResponse);
    await step(post("/api/photosedit/savecaption/", { image_hash: h("alice/e2e_01"), caption: "Same #summer" }), SaveCaptionResponse);
    await step(post("/api/photosedit/savecaption/", { image_hash: h("alice/e2e_05"), caption: "Lake day #summer" }), SaveCaptionResponse);
    await step(post("/api/photosedit/savecaption/", { image_hash: h("alice/no_thumbnail"), caption: "x" }), SaveCaptionResponse);
  });

  it("rotate (thumbnails: Django rebuilds inline, Rust queues thumbnails.rerender)", async () => {
    await step(
      post("/api/photosedit/rotate/", { image_hash: h("alice/e2e_06"), angle: 90 }),
      RotatePhotosResponse,
      ["status", "image_hash", "local_orientation"],
    );
    await step(
      post("/api/photosedit/rotate/", { image_hash: h("alice/e2e_06"), angle: -90, flip_horizontal: true }),
      RotatePhotosResponse,
      ["status", "image_hash", "local_orientation"],
    );
  });

  it("PATCH: category override and GPS (reverse geocoding off on both)", async () => {
    await step(
      { method: "PATCH", path: `/api/photos/edit/${h("alice/e2e_08")}/`, body: { is_screenshot: true, rating: 1 } },
      PhotoUpdateResponse,
    );
    await step(
      { method: "PATCH", path: `/api/photos/edit/${photo("alice/tokyo_01").id}/`, body: { exif_gps_lat: 48.137, exif_gps_lon: "11.575" } },
      PhotoUpdateResponse,
    );
  });

  it("public photo links", async () => {
    const shape = ["status", "share.enabled", "share.url"];
    const a = await step(post("/api/photo/share", { photo_id: h("alice/e2e_04") }), PhotoShareResponse, ["status", "share.enabled"]);
    const slug = (a.body as { share: { slug: string } }).share.slug;
    expect(slug).toHaveLength(12);
    await step(post("/api/photo/share", { photo_id: h("alice/e2e_08"), action: "enable" }), PhotoShareResponse, shape);
    await step(post("/api/photo/share", { photo_id: photo("alice/e2e_08").id, action: "rotate" }), PhotoShareResponse, ["status", "share.enabled"]);
    await step(post("/api/photo/share", { photo_id: h("alice/e2e_04"), action: "disable" }), PhotoShareResponse);
    await step(post("/api/photo/share", { photo_id: h("alice/e2e_05"), action: "disable" }), PhotoShareResponse);
    await step({ path: "/api/photo/share/list" }, null, ["results[].enabled", "results[].image_hash", "results[].photo_id"]);
  });

  it("purge: hashes, then select_all over the trash", async () => {
    await step(
      { method: "DELETE", path: "/api/photosedit/delete/", body: { image_hashes: [h("alice/trashed"), h("alice/e2e_02"), h("alice/e2e_01")] } },
      PurgePhotosResponse,
    );
    await step(
      { method: "DELETE", path: "/api/photosedit/delete/", body: { select_all: true, query: {}, excluded_hashes: [] } },
      PurgePhotosResponse,
    );
  });
});
