// More photo_edits mutations, sent once to each server: select_all with
// exclusions and forced trash, restores, odd-but-accepted inputs, a second
// owner. Run ONLY against two fresh clones with their own media copies
// (LP_MUTATION_REVIEW=1), then diff both databases and media trees with
// fixture/dump_state.py, as for mutations.test.ts.
import { describe, it } from "vitest";

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
import type { Role } from "../../src/manifest";

const enabled = hasBase && process.env.LP_MUTATION_REVIEW === "1";
const h = (key: string) => photo(key).image_hash;

type Req = Parameters<typeof call>[1];
const post = (path: string, body: unknown): Req => ({ method: "POST", path, body });

async function step(
  req: Req,
  schema: { parse: (x: unknown) => unknown } | null,
  project = ["*"],
  role: Role = "alice",
) {
  const { actual } = await expectTwin(role, req, { project, refStable: false });
  if (schema && actual.status === 200) expectSchema(schema as never, actual.body);
  return actual;
}

describe.skipIf(!enabled)("photo_edits mutations, review pass (twin, one pass)", () => {
  it("a bare string where a hash list belongs", async () => {
    await step(post("/api/photosedit/hide/", { image_hashes: h("alice/e2e_03"), hidden: true }), UpdatedPhotosResponse);
    await step(
      post("/api/photosedit/favorite/", { select_all: true, query: {}, excluded_hashes: h("alice/e2e_01"), favorite: true }),
      UpdatedPhotosResponse,
    );
    await step(
      { method: "DELETE", path: "/api/photosedit/delete/", body: { image_hashes: h("alice/trashed") } },
      PurgePhotosResponse,
    );
  });

  it("favorite select_all with no query, then off with string booleans", async () => {
    await step(post("/api/photosedit/favorite/", { select_all: true, favorite: false }), UpdatedPhotosResponse);
    await step(post("/api/photosedit/makepublic/", { image_hashes: [h("alice/e2e_05")], val_public: "False" }), UpdatedPhotosResponse);
  });

  it("trash by select_all, restore all but one (stack reviews), purge the rest", async () => {
    await step(post("/api/photosedit/setdeleted/", { select_all: true, query: { photo: true, show_all_stack_photos: true }, excluded_hashes: [h("alice/e2e_01")], deleted: true }), DeletePhotosResponse);
    await step(
      post("/api/photosedit/setdeleted/", {
        select_all: true,
        query: { in_trashcan: true, show_all_stack_photos: true },
        excluded_hashes: [h("alice/burst_3"), h("alice/dup_resized"), h("alice/manual_b")],
        deleted: false,
      }),
      DeletePhotosResponse,
    );
    await step(
      { method: "DELETE", path: "/api/photosedit/delete/", body: { select_all: true, query: { show_all_stack_photos: true }, excluded_hashes: [h("alice/trashed")] } },
      PurgePhotosResponse,
    );
  });

  it("share by select_all query, unshare by hashes", async () => {
    await step(post("/api/photosedit/share/", { select_all: true, query: { public: true }, val_shared: true, target_user_id: user("dave").id }), SharePhotosResponse);
    await step(post("/api/photosedit/share/", { image_hashes: [h("alice/berlin_01"), h("alice/e2e_06")], val_shared: false, target_user_id: user("dave").id }), SharePhotosResponse);
    // Django tests `if shared:`, so the string "false" shares.
    await step(post("/api/photosedit/share/", { image_hashes: [h("alice/e2e_02")], val_shared: "false", target_user_id: user("carol").id }), SharePhotosResponse);
  });

  it("captions: non-string, hashtags added and dropped", async () => {
    await step(post("/api/photosedit/savecaption/", { image_hash: h("alice/e2e_07"), caption: 123 }), SaveCaptionResponse);
    await step(post("/api/photosedit/savecaption/", { image_hash: h("alice/e2e_07"), caption: "  #road #trip  " }), SaveCaptionResponse);
    await step(post("/api/photosedit/savecaption/", { image_hash: h("alice/e2e_07"), caption: "#roadtrip" }), SaveCaptionResponse);
  });

  it("PATCH category flags by uuid; rotate flip-only and a full turn", async () => {
    await step(
      { method: "PATCH", path: `/api/photos/edit/${photo("alice/e2e_04").id}/`, body: { is_screenshot: false, is_document: "true", hidden: true } },
      PhotoUpdateResponse,
    );
    await step(post("/api/photosedit/rotate/", { image_hash: h("alice/berlin_02"), angle: 0, flip_horizontal: "false" }), RotatePhotosResponse, ["status", "image_hash", "local_orientation"]);
    await step(post("/api/photosedit/rotate/", { image_hash: h("alice/berlin_02"), angle: "-270" }), RotatePhotosResponse, ["status", "image_hash", "local_orientation"]);
    await step(post("/api/photosedit/rotate/", { image_hash: h("alice/berlin_02"), angle: 360 }), RotatePhotosResponse, ["status", "image_hash", "local_orientation"]);
  });

  it("public links: rotate without a share, disable twice", async () => {
    await step(post("/api/photo/share", { photo_id: h("alice/e2e_03"), action: "ROTATE" }), PhotoShareResponse, ["status", "share.enabled"]);
    await step(post("/api/photo/share", { photo_id: photo("alice/e2e_03").id, action: "disable" }), PhotoShareResponse);
    await step(post("/api/photo/share", { photo_id: photo("alice/e2e_03").id, action: "disable" }), PhotoShareResponse);
    await step(post("/api/photo/share", { photo_id: h("alice/e2e_03"), action: "" }), PhotoShareResponse, ["status", "share.enabled"]);
  });

  it("bob works on his own copy of alice's file", async () => {
    await step(post("/api/photosedit/favorite/", { image_hashes: [h("bob/e2e_01"), h("alice/e2e_01")], favorite: true }), UpdatedPhotosResponse, ["*"], "bob");
    await step(post("/api/photosedit/setdeleted/", { image_hashes: [h("bob/e2e_01")], deleted: true }), DeletePhotosResponse, ["*"], "bob");
    await step(
      { method: "DELETE", path: "/api/photosedit/delete/", body: { image_hashes: [h("bob/e2e_01"), h("bob/e2e_01"), h("alice/trashed")] } },
      PurgePhotosResponse,
      ["*"],
      "bob",
    );
  });
});
