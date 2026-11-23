// People & faces reads (03 §5 "People & faces"): contract (the frontend's own
// zod schemas), twin (Django on a clone of the same fixture) and authz.
import { FetchPeopleAlbumsResponse, IncompleteFacesResponse, PersonFaceListResponse as ApiPersonFaceList } from "@librephotos/api-client";
import { IncompletePersonFace } from "@fe/faces/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { manifest, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import {
  ClusterFacesResponse,
  PeopleResponse,
  PersonFaceListResponse,
  ScanFacesResponse,
  StatusMessage,
} from "../../src/schemas/people_faces";
import { expectTwin, twin } from "../../src/twin";

const persons = () => manifest().persons;
const faces = () => manifest().faces;

describe.skipIf(!hasBase)("GET /api/persons/?page_size=1000", () => {
  it("contract: alice's people page parses and lists her user-labelled persons by name", async () => {
    const res = await call("alice", { path: "/api/persons/?page_size=1000" });
    expect(res.status).toBe(200);
    const page = expectSchema(PeopleResponse, res.body);
    expectSchema(FetchPeopleAlbumsResponse, res.body);
    expect(page.results.map(p => p.id)).toEqual([persons().anna!.id, persons().ben!.id]);
    const anna = page.results[0]!;
    expect(anna.face_count).toBe(persons().anna!.face_count);
    expect(anna.face_photo_url).toBe(manifest().photos["alice/e2e_01"]!.image_hash);
    expect(anna.face_url).toMatch(/^\/media\/faces\//);
    expect(anna.video).toBe(false);
  });

  it.each(["alice", "bob", "carol", "dave", "admin"] as const)("twin: %s", async role => {
    await expectTwin(role, { path: "/api/persons/?page_size=1000" }, { project: ["*"] });
  });

  it("twin: pagination links and search", async () => {
    await expectTwin("alice", { path: "/api/persons/", query: { page_size: 1 } }, { project: ["*"] });
    await expectTwin("alice", { path: "/api/persons/", query: { page_size: 1, page: 2 } }, { project: ["*"] });
    await expectTwin("alice", { path: "/api/persons/", query: { page_size: 1, page: 3 } }, { project: ["*"] });
    await expectTwin("alice", { path: "/api/persons/", query: { search: "ben" } }, { project: ["*"] });
    await expectTwin("alice", { path: "/api/persons/", query: { search: "müller anna" } }, { project: ["*"] });
  });

  it("twin: ?search= narrows the detail route too; oversized ids are a query miss", async () => {
    await expectTwin("alice", { path: `/api/persons/${persons().anna!.id}/`, query: { search: "zzz" } }, { project: ["*"] });
    await expectTwin("alice", { path: `/api/persons/${persons().ben!.id}/`, query: { search: "BEN" } }, { project: ["*"] });
    await expectTwin("alice", { path: "/api/persons/99999999999/" }, { project: ["*"] });
  });

  it("twin: PATCH/PUT/POST validation errors (DRF field order, no writes)", async () => {
    const anna = `/api/persons/${persons().anna!.id}/`;
    for (const [method, path, body] of [
      ["PATCH", anna, { name: "" }],
      ["PATCH", anna, { name: null, face_count: "abc", newPersonName: "", cover_photo: null }],
      ["PATCH", anna, { face_count: 3.5 }],
      ["PATCH", anna, { face_count: 99999999999 }],
      ["PATCH", anna, { name: "x".repeat(129) }],
      ["PUT", anna, {}],
      ["PUT", anna, { name: "", face_count: "z" }],
      ["POST", "/api/persons/", {}],
      ["POST", "/api/persons/", { name: "  " }],
      ["POST", "/api/persons/", []],
    ] as const) {
      const { actual } = await expectTwin("alice", { method, path, body }, { project: ["*"] });
      expect(actual.status).toBe(400);
    }
  });

  it("twin: one person (the viewset's detail route)", async () => {
    for (const role of ["alice", "bob"] as const) {
      await expectTwin(role, { path: `/api/persons/${persons().anna!.id}/` }, { project: ["*"] });
      await expectTwin(role, { path: `/api/persons/${persons().cluster_1!.id}/` }, { project: ["*"] });
    }
  });
});

describe.skipIf(!hasBase)("GET /api/faces/incomplete/", () => {
  const variants: [string, Record<string, string>][] = [
    ["labelled", { inferred: "false", order_by: "confidence" }],
    ["inferred by clustering", { inferred: "true", order_by: "confidence", analysis_method: "clustering" }],
    ["inferred by classification", { inferred: "true", order_by: "date", analysis_method: "classification" }],
    ["classification above 0.65", { inferred: "true", analysis_method: "classification", min_confidence: "0.65" }],
    ["clustering above 0.85", { inferred: "true", analysis_method: "clustering", min_confidence: "0.85" }],
  ];

  it.each(variants)("contract: %s", async (_name, query) => {
    const res = await call("alice", { path: "/api/faces/incomplete/", query });
    expect(res.status).toBe(200);
    const list = expectSchema(z.array(IncompletePersonFace), res.body);
    expectSchema(IncompleteFacesResponse, res.body);
    expect(list.at(-1)).toMatchObject({ id: 0, name: "Unknown - Other" });
  });

  it.each(variants)("twin: %s", async (_name, query) => {
    for (const role of ["alice", "bob", "dave"] as const) {
      await expectTwin(role, { path: "/api/faces/incomplete/", query }, { project: ["*"] });
    }
  });

  it("twin: an unknown analysis method crashes both (status only; a 500 body is never shown)", async () => {
    const { ref, actual } = await twin(
      "alice",
      { path: "/api/faces/incomplete/", query: { inferred: "true", analysis_method: "bogus" } },
      { project: ["status"], refStable: false },
    );
    expect([ref.status, actual.status]).toEqual([500, 500]);
  });
});

describe.skipIf(!hasBase)("GET /api/faces/", () => {
  const cases = (): [string, Role, Record<string, string | number>][] => {
    const anna = persons().anna!.id;
    const ben = persons().ben!.id;
    const cluster = persons().cluster_1!.id;
    return [
      ["anna labelled", "alice", { person: anna, page: 1, inferred: "false", order_by: "confidence" }],
      ["anna labelled by date", "alice", { person: anna, page: 1, inferred: "false", order_by: "date" }],
      ["unknown, inferred view", "alice", { person: 0, page: 1, inferred: "true", order_by: "date" }],
      ["unknown, labelled view", "alice", { person: 0, page: 1, inferred: "false", order_by: "confidence" }],
      ["ben inferred (clustering)", "alice", { person: ben, page: 1, inferred: "true", order_by: "confidence" }],
      [
        "ben inferred (classification)",
        "alice",
        { person: ben, page: 1, inferred: "true", order_by: "confidence", analysis_method: "classification" },
      ],
      [
        "unknown (classification, min 0.65)",
        "alice",
        { person: 0, page: 1, inferred: "true", analysis_method: "classification", min_confidence: 0.65 },
      ],
      ["cluster 1", "alice", { person: cluster, page: 1, inferred: "true", order_by: "confidence" }],
      ["page size 2, page 2", "alice", { person: anna, page: 2, page_size: 2, inferred: "false" }],
      ["past the last page", "alice", { person: anna, page: 2, inferred: "false" }],
      ["alice's person as bob", "bob", { person: anna, page: 1, inferred: "false", order_by: "confidence" }],
      ["bob's own", "bob", { person: persons().bobs_friend!.id, page: 1, inferred: "false" }],
      // `person` reaches the ORM raw: empty is only falsy, blanks are int()-trimmed.
      ["empty person, inferred view", "alice", { person: "", page: 1, inferred: "true" }],
      ["empty person, labelled view", "alice", { person: "", page: 1, inferred: "false" }],
      ["padded person id", "alice", { person: ` ${anna}`, page: 1, inferred: "false" }],
    ];
  };

  it.each(cases())("contract + twin: %s", async (_name, role, query) => {
    const res = await call(role, { path: "/api/faces/", query });
    if (res.status === 200) {
      expectSchema(PersonFaceListResponse, res.body);
      expectSchema(ApiPersonFaceList, res.body);
    }
    await expectTwin(role, { path: "/api/faces/", query }, { project: ["*"] });
  });

  it("twin: a non-numeric person crashes both (status only)", async () => {
    const { ref, actual } = await twin(
      "alice",
      { path: "/api/faces/", query: { person: "abc", inferred: "true" } },
      { project: ["status"], refStable: false },
    );
    expect([ref.status, actual.status]).toEqual([500, 500]);
  });

  it("contract: anna's faces carry absolute images and the photo hash", async () => {
    const res = await call("alice", {
      path: "/api/faces/",
      query: { person: persons().anna!.id, page: 1, inferred: "false", order_by: "confidence" },
    });
    const page = expectSchema(PersonFaceListResponse, res.body);
    expect(page.count).toBe(faces().anna!.length);
    for (const f of page.results) {
      expect(f.image).toMatch(/^https?:\/\/.*\/media\/faces\//);
      expect(f.photo_image_hash).toMatch(/^[0-9a-f]{33}$/);
    }
  });
});

describe.skipIf(!hasBase)("face jobs with the face features off (as the reference runs)", () => {
  it("twin: GET /api/scanfaces is refused", async () => {
    const { actual } = await expectTwin("alice", { path: "/api/scanfaces" }, { project: ["*"] });
    expect(actual.status).toBe(403);
    expectSchema(StatusMessage, actual.body);
  });

  it("twin: POST /api/trainfaces is refused", async () => {
    const { actual } = await expectTwin(
      "alice",
      { method: "POST", path: "/api/trainfaces", body: {} },
      { project: ["*"], refStable: false },
    );
    expect(actual.status).toBe(403);
    expectSchema(ScanFacesResponse, actual.body);
  });
});

describe.skipIf(!hasBase)("GET /api/clusterfaces", () => {
  it("contract: alice's scatter plot parses", async () => {
    const res = await call("alice", { path: "/api/clusterfaces" });
    expect(res.status).toBe(200);
    const body = expectSchema(ClusterFacesResponse, res.body);
    expect(body.data).toHaveLength(10);
  });

  it.each(["alice", "dave", "admin"] as const)("twin: %s (PCA scores within 1e-9)", async role => {
    // Django's randomized SVD differs from itself in the last digits.
    await expectTwin(role, { path: "/api/clusterfaces" }, { project: ["*"], epsilon: 1e-9 });
  });

  it("bob's single face: Django fails (PCA needs 3 samples), Rust plots it at the origin", async () => {
    const { ref, actual } = await twin("bob", { path: "/api/clusterfaces" }, { project: ["status"], refStable: false });
    expect(ref.status).toBe(500);
    expect(actual.status).toBe(200);
    const body = expectSchema(ClusterFacesResponse, actual.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.value).toEqual({ x: 0, y: 0, size: 0 });
    expect(body.data[0]!.person_id).toBe(persons().bobs_friend!.id);
  });
});

describe.skipIf(!hasBase)("authz: people & faces reads", () => {
  const cases = (): AuthzCase[] => [
    { name: "people list", req: { path: "/api/persons/?page_size=1000" }, expect: { alice: 200, anonymous: 401 } },
    {
      name: "alice's person detail",
      req: { path: `/api/persons/${persons().anna!.id}/` },
      expect: { alice: 200, bob: 404, carol: 404, dave: 404, admin: 404, anonymous: 401 },
    },
    {
      name: "incomplete faces",
      req: { path: "/api/faces/incomplete/?inferred=false&order_by=confidence" },
      expect: { alice: 200, anonymous: 401 },
    },
    {
      name: "faces of anna",
      req: { path: `/api/faces/?person=${persons().anna!.id}&page=1&inferred=false&order_by=confidence` },
      expect: { alice: 200, bob: 200, anonymous: 401 },
    },
    {
      name: "cluster faces",
      req: { path: "/api/clusterfaces" },
      // bob is left out: Django 500s on his single face (see the twin case above).
      roles: ["admin", "alice", "carol", "dave", "anonymous"],
      expect: { alice: 200, anonymous: 401 },
    },
    { name: "scan faces", req: { path: "/api/scanfaces" }, expect: { alice: 403, anonymous: 401 } },
  ];

  it.each(cases())("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
