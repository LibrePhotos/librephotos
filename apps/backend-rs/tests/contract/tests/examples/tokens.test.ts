// Token refresh and logout (blacklist), as the shared transport and the
// logout handler call them. Each server mints its own pair, so the cases
// never spend a token the other server has to accept.
import { LoginResponse, RefreshResponse } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";

import { call, jwtClaims } from "../../src/client";
import { BASE_URL, REF_URL, hasBase } from "../../src/env";
import { user } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

async function pair(baseUrl: string) {
  const alice = user("alice");
  const res = await call(
    "anonymous",
    { method: "POST", path: "/api/auth/token/obtain/", body: { username: alice.username, password: alice.password } },
    baseUrl,
  );
  expect(res.status).toBe(200);
  return expectSchema(LoginResponse, res.body);
}

describe.skipIf(!hasBase)("POST /api/auth/token/refresh/ and /blacklist/", () => {
  it("refresh answers a new access token for the same user", async () => {
    const tokens = await pair(BASE_URL);
    const res = await call("anonymous", {
      method: "POST",
      path: "/api/auth/token/refresh/",
      body: { refresh: tokens.refresh },
    });
    expect(res.status).toBe(200);
    const refreshed = expectSchema(RefreshResponse, res.body);
    expect(String(jwtClaims(refreshed.access).user_id)).toBe(String(user("alice").id));
  });

  it("twin: a malformed refresh token", async () => {
    await expectTwin(
      "anonymous",
      { method: "POST", path: "/api/auth/token/refresh/", body: { refresh: "not-a-token" } },
      { project: ["errors[].field"] },
    );
  });

  it("twin: a missing refresh token", async () => {
    await expectTwin(
      "anonymous",
      { method: "POST", path: "/api/auth/token/refresh/", body: {} },
      { project: ["errors[].field"] },
    );
  });

  it("blacklist ends the refresh token on both servers alike", async () => {
    const seen: number[][] = [];
    for (const baseUrl of [REF_URL, BASE_URL]) {
      const tokens = await pair(baseUrl);
      const out = await call(
        "anonymous",
        { method: "POST", path: "/api/auth/token/blacklist/", body: { refresh: tokens.refresh } },
        baseUrl,
      );
      const again = await call(
        "anonymous",
        { method: "POST", path: "/api/auth/token/refresh/", body: { refresh: tokens.refresh } },
        baseUrl,
      );
      seen.push([out.status, again.status]);
    }
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[1]).toEqual([200, 401]);
  });
});
