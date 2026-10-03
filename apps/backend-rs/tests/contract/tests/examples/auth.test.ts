// LoginResponse lives in a hooks file on the frontend (useLoginMutation.ts,
// which imports React); packages/api-client carries the identical schema.
import { LoginResponse, TokenClaims } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call, jwtClaims } from "../../src/client";
import { hasBase } from "../../src/env";
import { user } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

describe.skipIf(!hasBase)("POST /api/auth/token/obtain/", () => {
  it("returns an access/refresh pair the frontend accepts, with the claims it reads", async () => {
    const alice = user("alice");
    const res = await call("anonymous", {
      method: "POST",
      path: "/api/auth/token/obtain/",
      body: { username: alice.username, password: alice.password },
    });
    expect(res.status).toBe(200);
    const tokens = expectSchema(LoginResponse, res.body);
    const claims = expectSchema(TokenClaims, jwtClaims(tokens.access));
    expect(parseInt(String(claims.user_id), 10)).toBe(alice.id);
    expect(claims.is_admin).toBe(false);
    expect(claims.token_type).toBe("access");
    // <img>/<video> send no Authorization header; media auth rides on this cookie.
    expect(res.headers.getSetCookie().some(c => c.startsWith(`jwt=${tokens.access}`))).toBe(true);
  });

  it("marks the superuser as admin", async () => {
    const admin = user("admin");
    const res = await call("anonymous", {
      method: "POST",
      path: "/api/auth/token/obtain/",
      body: { username: admin.username, password: admin.password },
    });
    const claims = jwtClaims(expectSchema(LoginResponse, res.body).access);
    expect(claims.is_admin).toBe(true);
  });

  it("twin: bad credentials give the reference's status and error fields", async () => {
    await expectTwin(
      "anonymous",
      {
        method: "POST",
        path: "/api/auth/token/obtain/",
        body: { username: "alice", password: "wrong-password" },
      },
      { project: ["errors[].field"] },
    );
  });

  it("answers a bad password with 401 and the errors envelope", async () => {
    const res = await call<{ errors: { field: string; message: string }[] }>("anonymous", {
      method: "POST",
      path: "/api/auth/token/obtain/",
      body: { username: "alice", password: "wrong-password" },
    });
    expect(res.status).toBe(401);
    expect(res.body.errors[0]?.message).toEqual(expect.any(String));
  });
});

describe.skipIf(!hasBase)("authz: GET /api/user/{id}/", () => {
  const cases: AuthzCase[] = [
    {
      name: "own user detail (alice)",
      req: { path: `/api/user/${user("alice").id}/` },
      // The viewset is scoped to visible users, so a stranger gets 404, not 401.
      expect: { alice: 200, anonymous: 404 },
    },
  ];

  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
