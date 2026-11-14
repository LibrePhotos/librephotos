// Settings > Services (ServiceList): list, health polled every 15 s,
// start/stop. Never start or stop a real sidecar here: Django's stop kills
// every matching process on the machine, and sidecar ports are shared.
import { ServiceHealthResponse, ServicesListResponse } from "@fe/services/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

describe.skipIf(!hasBase)("GET /api/services/", () => {
  it("contract: the list parses; exif is in-process in Rust, the rest match the reference", async () => {
    const res = await call("admin", { path: "/api/services/" });
    expect(res.status).toBe(200);
    const { services } = expectSchema(ServicesListResponse, res.body);
    expect(services).not.toHaveProperty("exif");
    const ref = await call<{ services: Record<string, number> }>("admin", { path: "/api/services/" }, process.env.LP_REF_URL);
    const refWithoutExif = Object.fromEntries(Object.entries(ref.body.services).filter(([k]) => k !== "exif"));
    const ours = Object.fromEntries(Object.entries(services).filter(([k]) => k !== "face_cluster"));
    expect(ours).toEqual(refWithoutExif);
  });

  it.each(["image_similarity", "thumbnail", "face_recognition", "clip_embeddings", "image_captioning", "tags", "ocr"])(
    "contract + twin: health of %s (health itself depends on the machine)",
    async name => {
      const res = await call("admin", { path: `/api/services/${name}/` });
      expect(res.status).toBe(200);
      expectSchema(ServiceHealthResponse, res.body);
      await expectTwin("admin", { path: `/api/services/${name}/` }, { project: ["service_name", "enabled", "feature_flag"] });
    },
  );

  it("twin: unknown service is 404 with an error", async () => {
    await expectTwin("admin", { path: "/api/services/nope/" }, { project: ["*"] });
    await expectTwin("admin", { method: "POST", path: "/api/services/nope/start/", body: {} }, { project: ["*"], refStable: false });
    await expectTwin("admin", { method: "POST", path: "/api/services/nope/stop/", body: {} }, { project: ["*"], refStable: false });
  });

  it("twin: starting a switched-off service is a 409 naming why", async () => {
    for (const name of ["face_recognition", "ocr", "tags"]) {
      await expectTwin("admin", { method: "POST", path: `/api/services/${name}/start/`, body: {} }, { project: ["*"], refStable: false });
    }
  });
});

describe.skipIf(!hasBase)("authz: services (IsAdminUser)", () => {
  const cases: AuthzCase[] = [
    { name: "list", req: { path: "/api/services/" }, expect: { admin: 200, alice: 403, anonymous: 401 } },
    { name: "health", req: { path: "/api/services/ocr/" }, expect: { admin: 200, bob: 403, anonymous: 401 } },
    {
      name: "start",
      req: { method: "POST", path: "/api/services/ocr/start/", body: {} },
      expect: { admin: 409, alice: 403, anonymous: 401 },
    },
    {
      name: "stop",
      req: { method: "POST", path: "/api/services/ocr/stop/", body: {} },
      roles: ["alice", "dave", "anonymous"],
      expect: { alice: 403, anonymous: 401 },
    },
  ];

  it("matrix matches the reference", async () => {
    const matrix = await authzMatrix(cases);
    for (const c of cases) expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
