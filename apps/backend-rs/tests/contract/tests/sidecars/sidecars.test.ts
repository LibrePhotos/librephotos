// Sidecar-backed views, with both servers talking to the same deterministic
// mock (tests/tasks/mock_sidecars.py): Rust through LP_SIDECAR_<NAME>_URL,
// Django through fixture/lp_twin_mock.py (exif in-process). Face detection,
// clustering, captioning and tagging are on for both. Mutating and setup-dependent: run
// through `run_suite.sh mut:sidecars` (LP_SIDECAR_MOCK=1), whose sidecars.sql
// gives alice's photos CLIP embeddings and semantic_search_topk = 4 and whose
// sidecars.sh puts stub captioner files into both media copies.
import { SemanticSearchPhotos } from "@fe/search/types";
import { Photo } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";

import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { category, photo } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { ScanFacesResponse } from "../../src/schemas/people_faces";
import { GenerateCaptionResponse } from "../../src/schemas/photo_edits";
import { expectTwin } from "../../src/twin";

const enabled = hasBase && process.env.LP_SIDECAR_MOCK === "1";

// PigPhoto fields the grid reads (03 §4), stack photo_count left out (see
// search.test.ts).
const PIG = [
  "id",
  "image_hash",
  "url",
  "aspectRatio",
  "dominantColor",
  "type",
  "video_length",
  "rating",
  "date",
  "birthTime",
  "location",
  "owner",
  "exif_gps_lat",
  "exif_gps_lon",
  "removed",
  "in_trashcan",
  "has_raw_variant",
  "local_orientation",
];

describe.skipIf(!enabled)("semantic search (semantic_search_topk > 0)", () => {
  it.each([["beach"], ["berlin"], ["zzz-no-such-thing"]])("twin + contract: %s", async search => {
    // The semantic branch is a flat list without ORDER BY on Django.
    const { actual } = await expectTwin(
      "alice",
      { path: "/api/photos/searchlist/", query: { search } },
      { project: PIG.map(f => `results[].${f}`), unordered: ["results"] },
    );
    expect(actual.status).toBe(200);
    const { results } = expectSchema(SemanticSearchPhotos, actual.body);
    // The mock's matches are OR-ed in, so even a term matching nothing finds photos.
    expect(results.length).toBeGreaterThan(0);
  });

  it("twin: a user without semantic search still gets date groups", async () => {
    await expectTwin("bob", { path: "/api/photos/searchlist/", query: { search: "own" } }, {
      project: ["results[].date", "results[].items[].image_hash"],
      unordered: ["results[].items"],
    });
  });
});

describe.skipIf(!enabled)("photo detail similar_photos", () => {
  it("twin: the owner sees the similarity index's matches", async () => {
    const p = photo("alice/e2e_01");
    const { actual } = await expectTwin(
      "alice",
      { path: `/api/photos/${p.image_hash}/` },
      { project: ["similar_photos[].image_hash", "similar_photos[].type"], unordered: ["similar_photos"] },
    );
    const d = expectSchema(Photo, actual.body);
    expect((d.similar_photos ?? []).length).toBeGreaterThan(0);
  });

  it("twin: a share recipient sees only the matches shared with them", async () => {
    for (const p of category("shared_to_bob").filter(x => x.owner === "alice")) {
      await expectTwin(
        "bob",
        { path: `/api/photos/${p.image_hash}/` },
        { project: ["similar_photos[].image_hash", "similar_photos[].type"], unordered: ["similar_photos"] },
      );
    }
  });
});

describe.skipIf(!enabled)("POST /api/photosedit/generateim2txt", () => {
  it("twin: the owner gets a caption, stored in captions_json", async () => {
    const h = photo("alice/e2e_02").image_hash;
    const { actual } = await expectTwin(
      "alice",
      { method: "POST", path: "/api/photosedit/generateim2txt/", body: { image_hash: h } },
      { project: ["*"], refStable: false },
    );
    expect(actual.status).toBe(200);
    expect(expectSchema(GenerateCaptionResponse, actual.body).status).toBe(true);
    const detail = await expectTwin("alice", { path: `/api/photos/${h}/` }, { project: ["captions_json.im2txt"] });
    expect(String((detail.actual.body as { captions_json: { im2txt: string } }).captions_json.im2txt)).toContain("a photo of");
  });

  it("twin: someone else's photo is not found", async () => {
    await expectTwin(
      "bob",
      { method: "POST", path: "/api/photosedit/generateim2txt/", body: { image_hash: photo("alice/e2e_03").image_hash } },
      { project: ["*"], refStable: false },
    );
  });
});

describe.skipIf(!enabled)("face jobs with face detection on", () => {
  it("twin: GET /api/scanfaces starts a scan", async () => {
    const { actual } = await expectTwin("dave", { path: "/api/scanfaces" }, { project: ["status"], refStable: false });
    expect(actual.status).toBe(200);
    expect(expectSchema(ScanFacesResponse, actual.body).job_id).toBeTruthy();
  });

  it("twin: POST /api/scanfaces starts a scan", async () => {
    const { actual } = await expectTwin(
      "dave",
      { method: "POST", path: "/api/scanfaces", body: {} },
      { project: ["status"], refStable: false },
    );
    expect(expectSchema(ScanFacesResponse, actual.body).status).toBe(true);
  });

  it("twin: POST /api/trainfaces starts training", async () => {
    const { actual } = await expectTwin(
      "dave",
      { method: "POST", path: "/api/trainfaces", body: {} },
      { project: ["status"], refStable: false },
    );
    expect(actual.status).toBe(200);
    expect(expectSchema(ScanFacesResponse, actual.body).job_id).toBeTruthy();
  });

  it("twin: anonymous is refused", async () => {
    await expectTwin("anonymous", { path: "/api/scanfaces" }, { project: ["*"] });
  });
});

describe.skipIf(!enabled)("the jobs they started", () => {
  it("contract: the Rust worker finishes dave's face scan against the mock", async () => {
    // Django has no qcluster here, so only the server under test runs them.
    let jobs: { job_type_str: string; finished: boolean; failed: boolean }[] = [];
    for (let i = 0; i < 60; i++) {
      const res = await call<{ results: typeof jobs }>("dave", { path: "/api/jobs/", query: { page_size: "50" } });
      jobs = res.body.results.filter(j => j.job_type_str === "Scan Faces");
      if (jobs.length > 0 && jobs.every(j => j.finished)) break;
      await new Promise(r => setTimeout(r, 500));
    }
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.filter(j => j.failed)).toEqual([]);
  });
});
