// People & faces mutations, run once against two fresh clones with their own
// media copies (Django = LP_REF_URL, Rust = LP_BASE_URL); afterwards diff the
// databases and media trees with dump_state.py (tests/README.md §4).
//
//   LP_MUTATION_CLONES=1 LP_BASE_URL=... LP_REF_URL=... npx vitest run tests/people_faces/mutations
//
// Every step goes to both servers in the same order, so ids minted on the way
// (the new persons and faces) are the same on both sides.
import { DeleteFacesResponse, SetFacesLabelResponse } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { BASE_URL, REF_URL, hasBase } from "../../src/env";
import { manifest, photo } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { AddFaceResponse, PeopleResponse, StatusMessage } from "../../src/schemas/people_faces";
import { expectTwin, twin, type TwinSpec } from "../../src/twin";

const enabled = hasBase && process.env.LP_MUTATION_CLONES === "1" && BASE_URL !== REF_URL;
const once: Pick<TwinSpec, "refStable"> = { refStable: false };
const persons = () => manifest().persons;
const faces = () => manifest().faces;

describe.skipIf(!enabled).sequential("people & faces mutations (two clones)", () => {
  let carla = 0;

  it("authz: strangers cannot touch alice's persons and faces", async () => {
    const anna = persons().anna!.id;
    const cases: AuthzCase[] = [
      {
        name: "rename alice's person",
        req: { method: "PATCH", path: `/api/persons/${anna}/`, body: { newPersonName: "pwned" } },
        roles: ["bob", "dave", "anonymous"],
        expect: { bob: 404, dave: 404, anonymous: 401 },
      },
      {
        name: "delete alice's person",
        req: { method: "DELETE", path: `/api/persons/${anna}/` },
        roles: ["bob", "dave", "anonymous"],
        expect: { bob: 404, dave: 404, anonymous: 401 },
      },
      {
        name: "label alice's faces",
        req: { method: "POST", path: "/api/labelfaces", body: { face_ids: faces().anna, person_name: "Mallory" } },
        roles: ["bob", "anonymous"],
        expect: { bob: 200, anonymous: 401 },
      },
      {
        name: "delete alice's faces",
        req: { method: "POST", path: "/api/deletefaces", body: { face_ids: faces().anna } },
        roles: ["bob", "anonymous"],
        expect: { bob: 200, anonymous: 401 },
      },
      {
        name: "draw on alice's photo",
        req: {
          method: "POST",
          path: "/api/addface",
          body: { photo: photo("alice/e2e_05").id, person_name: "Mallory", box: { top: 0.5, right: 0.8, bottom: 0.8, left: 0.6 } },
        },
        roles: ["bob", "anonymous"],
        expect: { bob: 404, anonymous: 401 },
      },
    ];
    for (const c of cases) {
      const matrix = await authzMatrix([c]);
      expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
    }
  });

  it("twin: bob's label request on alice's faces updates nothing", async () => {
    const { actual } = await expectTwin(
      "bob",
      { method: "POST", path: "/api/labelfaces", body: { face_ids: faces().anna, person_name: "Mallory" } },
      { project: ["*"], ...once },
    );
    expect(expectSchema(SetFacesLabelResponse, actual.body).results).toEqual([]);
  });

  it("twin: label validation errors", async () => {
    for (const person_name of ["", "   ", "Cluster 1"]) {
      const { actual } = await expectTwin(
        "alice",
        { method: "POST", path: "/api/labelfaces", body: { face_ids: faces().unknown, person_name } },
        { project: ["*"], ...once },
      );
      expect(actual.status).toBe(400);
      expectSchema(StatusMessage, actual.body);
    }
  });

  it("twin: label an unknown and an inferred face as a new person", async () => {
    const { actual } = await expectTwin(
      "alice",
      {
        method: "POST",
        path: "/api/labelfaces",
        body: { face_ids: [...faces().unknown!, ...faces().inferred_ben!], person_name: " Carla " },
      },
      { project: ["*"], unordered: ["results", "updated"], ...once },
    );
    const body = expectSchema(SetFacesLabelResponse, actual.body);
    expect(body.results).toHaveLength(2);
    carla = body.results[0]!.person!;
    expect(body.results.every(f => f.person_name === "Carla")).toBe(true);
  });

  it("twin: push a face back to unknown, move one of anna's to ben", async () => {
    await expectTwin(
      "alice",
      { method: "POST", path: "/api/labelfaces", body: { face_ids: faces().inferred_ben, person_name: "Unknown - Other" } },
      { project: ["*"], ...once },
    );
    await expectTwin(
      "alice",
      { method: "POST", path: "/api/labelfaces", body: { face_ids: [faces().anna![3]], person_name: "Ben" } },
      { project: ["*"], ...once },
    );
  });

  it("twin: soft-delete a cluster face", async () => {
    const { actual } = await expectTwin(
      "alice",
      { method: "POST", path: "/api/deletefaces", body: { face_ids: [faces().cluster_1![0], 999999] } },
      { project: ["*"], ...once },
    );
    expect(expectSchema(DeleteFacesResponse, actual.body).deleted).toHaveLength(1);
  });

  it("twin: rename ben, set anna's cover by hash and by id, reject a foreign cover", async () => {
    const ben = persons().ben!.id;
    const anna = persons().anna!.id;
    // The frontend ignores these bodies; status and the errors envelope matter.
    for (const [id, body] of [
      [ben, { newPersonName: "  Benjamin " }],
      [ben, { newPersonName: "" }],
      [ben, { newPersonName: "x".repeat(101) }],
      [anna, { cover_photo: photo("alice/e2e_05").image_hash }],
      [anna, { cover_photo: photo("alice/e2e_02").id }],
      [anna, { cover_photo: photo("bob/own_01").image_hash }],
    ] as const) {
      await expectTwin("alice", { method: "PATCH", path: `/api/persons/${id}/`, body }, { project: ["*"], ...once });
    }
  });

  it("twin: PUT renames through newPersonName, POST finds or creates a person", async () => {
    const ben = persons().ben!.id;
    await expectTwin(
      "alice",
      { method: "PUT", path: `/api/persons/${ben}/`, body: { name: "ignored", newPersonName: "Benjamin" } },
      { project: ["*"], ...once },
    );
    // Django renders a person without faces with `video: "False"`, Rust with false.
    const created = await expectTwin(
      "alice",
      { method: "POST", path: "/api/persons/", body: { name: " Zoe " } },
      { project: ["status", "name", "face_url", "face_count", "face_photo_url", "id"], ...once },
    );
    expect(created.actual.status).toBe(201);
    expect(created.actual.body).toMatchObject({ name: "Zoe", video: false });
    for (const name of ["Zoe", "Cluster 1"]) {
      await expectTwin(
        "alice",
        { method: "POST", path: "/api/persons/", body: { name } },
        { project: ["status", "name", "face_url", "face_count", "face_photo_url", "id"], ...once },
      );
    }
  });

  it("twin: draw faces by hand", async () => {
    const e2e05 = photo("alice/e2e_05");
    const box = { top: 0.5, right: 0.8, bottom: 0.8, left: 0.6 };
    const bad: unknown[] = [
      { photo: e2e05.id, person_name: "", box },
      { photo: e2e05.id, person_name: "Unknown - Other", box },
      { person_name: "Dora", box },
      { photo: e2e05.id, person_name: "Dora" },
      { photo: e2e05.id, person_name: "Dora", box: { ...box, top: 1.5 } },
      { photo: e2e05.id, person_name: "Dora", box: { ...box, top: "x" } },
      { photo: e2e05.id, person_name: "Dora", box: { ...box, right: 0.5 } },
      { photo: e2e05.id, person_name: "Dora", box: { ...box, right: 0.61 } },
      { photo: e2e05.id, person_name: "Dora", box: { top: 0.2, right: 0.5, bottom: 0.45, left: 0.3 } },
      { photo: "0".repeat(32), person_name: "Dora", box },
      { photo: photo("alice/no_thumbnail").id, person_name: "Dora", box },
    ];
    for (const body of bad) {
      const { actual } = await expectTwin("alice", { method: "POST", path: "/api/addface", body }, { project: ["*"], ...once });
      expectSchema(StatusMessage, actual.body);
    }
    // The crop's file name is random on both sides; the rest must match.
    const { actual } = await expectTwin(
      "alice",
      { method: "POST", path: "/api/addface", body: { photo: e2e05.image_hash, person_name: " Dora ", box } },
      { project: ["status", "face.face_id", "face.person", "face.person_name", "face.location"], ...once },
    );
    expect(actual.status).toBe(201);
    const added = expectSchema(AddFaceResponse, actual.body);
    expect(added.face.face_url).toMatch(new RegExp(`^/media/faces/${e2e05.image_hash}_manual_[0-9a-f]{8}\\.jpg$`));
    const again = await expectTwin(
      "alice",
      { method: "POST", path: "/api/addface", body: { photo: e2e05.id, person_name: "Dora", box } },
      { project: ["*"], ...once },
    );
    expect(again.actual.status).toBe(409);
  });

  it("twin: the people page and face lists agree afterwards", async () => {
    // Dora's cover crop has a random file name on each side, and Zoe (no
    // faces) is `video: "False"` on Django.
    const { actual } = await expectTwin(
      "alice",
      { path: "/api/persons/?page_size=1000" },
      { project: ["count", "results[].id", "results[].name", "results[].face_count", "results[].face_photo_url"] },
    );
    expectSchema(PeopleResponse, actual.body);
    await expectTwin("alice", { path: "/api/faces/incomplete/?inferred=false" }, { project: ["*"] });
    await expectTwin("alice", { path: "/api/faces/incomplete/?inferred=true&analysis_method=clustering" }, { project: ["*"] });
    for (const person of [0, persons().anna!.id, persons().ben!.id]) {
      await expectTwin(
        "alice",
        { path: "/api/faces/", query: { person, page: 1, inferred: "false", order_by: "confidence" } },
        { project: ["count", "results[].id", "results[].photo", "results[].person_label_probability"] },
      );
    }
    const res = await call("alice", { path: "/api/clusterfaces" });
    expect(res.status).toBe(200);
  });
  it("delete carla: Django 500s and rolls back, Rust deletes (S3)", async () => {
    // Django bug: PersonViewSet's queryset defers `kind` (.only()), and the
    // sync tombstone post_delete signal reads it from the deleted row, so
    // DoesNotExist aborts the delete transaction. Rust does what the view
    // means to do; the resulting state was checked against
    // `Person.objects.get(pk=...).delete()` run in a Django shell on the
    // reference clone (dump_state diff, see the report).
    expect(carla).toBeGreaterThan(0);
    const { ref, actual } = await twin("alice", { method: "DELETE", path: `/api/persons/${carla}/` }, {
      project: ["status"],
      ...once,
    });
    expect(ref.status).toBe(500);
    expect(actual.status).toBe(204);
    const again = await call("alice", { method: "DELETE", path: `/api/persons/${carla}/` });
    expect(again.status).toBe(404);
  });
});
