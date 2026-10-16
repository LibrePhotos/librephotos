/**
 * The face endpoints the web's face dashboard and lightbox use (issue #2347): the request each one
 * sends and the parsed answer, against what api/views/faces.py and api/views/dataviz.py answered in
 * a test run.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { IncompleteFacesResponse, PersonFaceListResponse } from "../schemas";
import { defined } from "./defined";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";

/** GET /faces/?person=1&page=1&inferred=true&order_by=confidence&analysis_method=clustering */
const facePage = {
  count: 2,
  next: null,
  previous: null,
  results: [
    {
      id: 6,
      image: "http://testserver/media/faces/6.jpg",
      face_url: "/media/faces/6.jpg",
      photo: "b1988620-8929-4dca-b2ef-2fd065646447",
      photo_image_hash: "82d63ece5bcca091897a1d06d477dd6e1",
      timestamp: "2023-05-05T10:00:00Z",
      person_label_probability: 0.9,
    },
    {
      id: 7,
      image: "http://testserver/media/faces/7.jpg",
      face_url: "/media/faces/7.jpg",
      photo: "0ec0f509-1fae-4219-85a0-0d06669ebf71",
      photo_image_hash: "1ff85731da24322ce010c597385c678d1",
      timestamp: null,
      person_label_probability: 0.7,
    },
  ],
  page: 1,
  page_size: 100,
  num_pages: 1,
};

/** GET /faces/incomplete/?inferred=true&order_by=confidence&analysis_method=clustering */
const incomplete = [
  { id: 1, name: "Alice", kind: "USER", face_count: 2 },
  { id: 3, name: "Carol", kind: "CLUSTER", face_count: 1 },
  { id: 0, name: "Unknown - Other", face_count: 2, kind: "Unknown - Other" },
];

describe("face schemas", () => {
  it("reads a real face page (no person or person_name: PersonFaceListSerializer does not send them)", () => {
    const parsed = PersonFaceListResponse.parse(facePage);
    expect(defined(parsed.results[0]).person_label_probability).toBe(0.9);
    expect(defined(parsed.results[1]).person).toBeUndefined();
  });

  it("reads the incomplete list with its Unknown - Other entry", () => {
    const parsed = IncompleteFacesResponse.parse(incomplete);
    expect(parsed.map(person => person.name)).toEqual(["Alice", "Carol", "Unknown - Other"]);
  });

  it("rejects a person without a name: the serializer always sends one", () => {
    expect(IncompleteFacesResponse.safeParse([{ id: 1, name: null, kind: "USER", face_count: 1 }]).success).toBe(false);
  });
});

describe("face reads", () => {
  it("asks for one page of a person's faces", async () => {
    const { client, requests } = fakeServer(facePage);
    const page = await endpoints.fetchFaces(client, {
      person: 1,
      page: 2,
      inferred: true,
      orderBy: "date",
      analysisMethod: "clustering",
      minConfidence: 0.5,
    });
    expect(defined(requests[0]).url).toBe(
      `${API}/faces/?person=1&page=2&inferred=true&order_by=date&analysis_method=clustering&min_confidence=0.5`
    );
    expect(page.results).toHaveLength(2);
  });

  it("asks for the incomplete list with a confidence threshold", async () => {
    const { client, requests } = fakeServer(incomplete);
    const people = await endpoints.fetchIncompleteFaces(client, {
      inferred: true,
      orderBy: "confidence",
      analysisMethod: "classification",
      minConfidence: 0.7,
    });
    expect(defined(requests[0]).url).toBe(
      `${API}/faces/incomplete/?inferred=true&order_by=confidence&analysis_method=classification&min_confidence=0.7`
    );
    expect(people).toHaveLength(3);
  });

  it("leaves the method and threshold out of the confirmed list", async () => {
    const { client, requests } = fakeServer(incomplete);
    await endpoints.fetchIncompleteFaces(client, { inferred: false, orderBy: "date", analysisMethod: "clustering" });
    expect(defined(requests[0]).url).toBe(`${API}/faces/incomplete/?inferred=false&order_by=date`);
  });

  it("reads the face cluster chart", async () => {
    const { client, requests } = fakeServer({
      status: true,
      data: [
        {
          person_id: 1,
          person_name: "Alice",
          person_label_is_inferred: false,
          color: "#ff0000",
          face_url: "/media/faces/6.jpg",
          value: { x: 1.5, y: -0.25, size: 0.1 },
        },
        {
          person_id: -1,
          person_name: "unknown",
          person_label_is_inferred: true,
          color: "#000000",
          face_url: "/media/faces/9.jpg",
          value: { x: 0, y: 2, size: -1 },
        },
      ],
    });
    const clusters = await endpoints.fetchClusterFaces(client);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/clusterfaces`, method: "GET" });
    expect(clusters.data.map(point => point.person_id)).toEqual([1, -1]);
  });
});

describe("face writes", () => {
  it("adds a face from a drawn box and reads it back in pixels", async () => {
    const { client, requests } = fakeServer(
      {
        status: true,
        face: {
          face_id: 11,
          face_url: "/media/faces/x_manual_2b05b554.jpg",
          person: 4,
          person_name: "Dave",
          location: { top: 150, right: 480, bottom: 450, left: 320 },
        },
      },
      201
    );
    const box = { top: 0.25, right: 0.6, bottom: 0.75, left: 0.4 };
    const added = await endpoints.addFace(client, "h1", "Dave", box);
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/addface`,
      method: "POST",
      body: { photo: "h1", person_name: "Dave", box },
    });
    expect(added.face.location.right).toBe(480);
  });

  it("keeps why a face edit did not reach the file (#2564)", async () => {
    const reason = "the folder /photos is read-only";
    const face = { id: 3, person: 4, person_name: "Dave" };
    const labelled = fakeServer({
      status: true,
      results: [face],
      updated: [face],
      not_updated: [],
      write_error: reason,
    });
    expect((await endpoints.labelFaces(labelled.client, [3], "Dave")).write_error).toBe(reason);

    const drawn = fakeServer(
      {
        status: true,
        write_error: reason,
        face: {
          face_id: 11,
          face_url: "/media/faces/11.jpg",
          person: 4,
          person_name: "Dave",
          location: { top: 1, right: 2, bottom: 3, left: 0 },
        },
      },
      201
    );
    const box = { top: 0.25, right: 0.6, bottom: 0.75, left: 0.4 };
    expect((await endpoints.addFace(drawn.client, "h1", "Dave", box)).write_error).toBe(reason);
  });

  it("starts a face scan", async () => {
    const { client, requests } = fakeServer({ status: true, job_id: "j1", job_ids: ["j1"] });
    const started = await endpoints.scanFaces(client);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/scanfaces`, method: "POST", body: {} });
    expect(started.job_id).toBe("j1");
  });

  it("narrows a face scan to a folder or to some photos (#524)", async () => {
    const { client, requests } = fakeServer({ status: true, job_id: "j1", job_ids: ["j1"] });
    await endpoints.scanFaces(client, { path: "/data/alice/2025" });
    await endpoints.scanFaces(client, { photo_ids: ["p1", "p2"] });
    expect(requests.map(request => request.body)).toEqual([{ path: "/data/alice/2025" }, { photo_ids: ["p1", "p2"] }]);
  });

  it("follows a face scan that is already running", async () => {
    const { client } = fakeServer(
      {
        errors: [
          {
            field: "detail",
            message: "Scan Faces is already running.",
            code: "job_already_running",
            job_id: "f5235721-681d-4675-9a18-8761fb6aba37",
          },
        ],
      },
      409
    );
    const started = await endpoints.scanFaces(client);
    expect(started).toEqual({ status: true, job_id: "f5235721-681d-4675-9a18-8761fb6aba37", already_running: true });
  });
});

describe("undoing face edits (#127)", () => {
  const labels = { id: 3, person: null, cluster_person: 5, classification_person: null };

  it("lists the deleted faces without the method and threshold", async () => {
    const people = fakeServer(incomplete);
    await endpoints.fetchIncompleteFaces(people.client, { inferred: false, orderBy: "date", deleted: true });
    expect(defined(people.requests[0]).url).toBe(`${API}/faces/incomplete/?inferred=false&order_by=date&deleted=true`);

    const page = fakeServer(facePage);
    await endpoints.fetchFaces(page.client, { person: 1, page: 1, inferred: false, orderBy: "date", deleted: true });
    expect(defined(page.requests[0]).url).toBe(
      `${API}/faces/?person=1&page=1&inferred=false&order_by=date&deleted=true`
    );
  });

  it("keeps a labelling's previous people for its undo", async () => {
    const { client } = fakeServer({ status: true, results: [], updated: [], not_updated: [], previous: [labels] });
    expect((await endpoints.labelFaces(client, [3], "Dave")).previous).toEqual([labels]);
  });

  it("restores deleted faces", async () => {
    const { client, requests } = fakeServer({ restored_ids: [3, 4], write_error: null });
    const restored = await endpoints.restoreFaces(client, [3, 4]);
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/restore-faces/`,
      method: "POST",
      body: { face_ids: [3, 4] },
    });
    expect(restored.restored_ids).toEqual([3, 4]);
  });

  it("sends a labelling's previous people back", async () => {
    const { client, requests } = fakeServer({ restored_ids: [3], write_error: "read-only" });
    const restored = await endpoints.restoreFaceLabels(client, [labels]);
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/restore-face-labels/`,
      method: "POST",
      body: { faces: [labels] },
    });
    expect(restored.write_error).toBe("read-only");
  });
});
