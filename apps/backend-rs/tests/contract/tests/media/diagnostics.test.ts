/**
 * GET /api/media/diagnostics/{hash}/ (admins): parsed by the frontend with
 * MediaDiagnostics (useMediaDiagnosticsQuery). From
 * api/tests/media_serving/test_serving_permissions.py (view tests).
 */
import { MediaDiagnostics } from "@fe/media/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { photo } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

const path = (id: string) => `/api/media/diagnostics/${id}/`;

describe.skipIf(!hasBase)("GET /api/media/diagnostics/{fname}/", () => {
  it("contract: an admin's diagnosis parses with the frontend schema", async () => {
    const res = await call("admin", { path: path(photo("alice/video").image_hash) });
    expect(res.status).toBe(200);
    const parsed = expectSchema(MediaDiagnostics, res.body);
    expect(parsed.path).toContain("clip.mp4");
  });

  it.each([
    ["by hash", photo("alice/video").image_hash],
    ["by uuid", photo("alice/video").id],
    ["a still", photo("alice/e2e_01").image_hash],
    ["unicode name", photo("alice/unicode").image_hash],
    ["detached main file", photo("alice/removed").image_hash],
    ["unknown hash", "0123456789abcdef0123456789abcdef9"],
    ["malformed uuid falls back to a hash lookup", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"],
  ])("twin: %s", async (_name, id) => {
    const { actual } = await expectTwin("admin", { path: path(id) }, { project: ["*"] });
    if (actual.status === 200) expectSchema(MediaDiagnostics, actual.body);
  });

  it("authz: administrators only", async () => {
    const c: AuthzCase = {
      name: "diagnostics",
      req: { path: path(photo("alice/e2e_01").image_hash) },
      expect: { admin: 200, alice: 403, bob: 403, carol: 403, dave: 403, anonymous: 401 },
    };
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
