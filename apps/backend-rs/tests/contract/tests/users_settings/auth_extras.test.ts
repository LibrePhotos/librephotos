// Area users_settings, auth extras: /api/auth/sso/config/,
// /api/auth/password/reset/ and /confirm/ (no email is configured in the
// fixture, so nothing is sent; nothing is written on the rejected confirms).
import { SsoConfigSchema } from "@fe/auth/types";
import { describe, expect, it } from "vitest";

import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { ROLES, user } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { PasswordResetConfirmResponse, PasswordResetResponse } from "../../src/schemas/users_settings";
import { expectTwin } from "../../src/twin";

describe.skipIf(!hasBase)("GET /api/auth/sso/config/", () => {
  it.each(ROLES)("contract + twin as %s", async role => {
    const res = await call(role, { path: "/api/auth/sso/config/" });
    expect(res.status).toBe(200);
    expectSchema(SsoConfigSchema, res.body);
    await expectTwin(role, { path: "/api/auth/sso/config/" }, { project: ["enabled", "label", "providers[].*"] });
  });

  it("twin: unauthenticated view, so a bad token is ignored", async () => {
    await expectTwin(
      "anonymous",
      { path: "/api/auth/sso/config/", headers: { Authorization: "Bearer nope" } },
      { project: ["enabled", "label", "providers"] },
    );
  });
});

describe.skipIf(!hasBase)("POST /api/auth/password/reset/", () => {
  // A fresh X-Forwarded-For per run: both servers key the anonymous throttle
  // (5/hour) on it, so reruns do not trip over earlier runs.
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const headers = { "X-Forwarded-For": ip };

  it("contract + twin: always 200, whether or not the address exists", async () => {
    const me = await call<{ email: string }>("alice", { path: `/api/user/${user("alice").id}/` });
    for (const email of [me.body.email, "nobody@example.com", ""]) {
      const res = await call("anonymous", { method: "POST", path: "/api/auth/password/reset/", body: { email }, headers });
      expect(res.status).toBe(200);
      expectSchema(PasswordResetResponse, res.body);
    }
    await expectTwin(
      "anonymous",
      { method: "POST", path: "/api/auth/password/reset/", body: { email: "Nobody@Example.com" }, headers },
      { project: ["status", "message"], refStable: false },
    );
  });

  it("twin: the sixth request within the hour is throttled", async () => {
    const own = { "X-Forwarded-For": `${ip}-burst` };
    for (let i = 0; i < 5; i++) {
      await expectTwin(
        "anonymous",
        { method: "POST", path: "/api/auth/password/reset/", body: { email: "x@example.com" }, headers: own },
        { project: ["status"], refStable: false },
      );
    }
    const res = await expectTwin(
      "anonymous",
      { method: "POST", path: "/api/auth/password/reset/", body: { email: "x@example.com" }, headers: own },
      { project: ["errors[].field"], refStable: false },
    );
    expect(res.actual.status).toBe(429);
    const retry = (r: typeof res.ref) => Number(r.headers.get("retry-after"));
    expect(Math.abs(retry(res.actual) - retry(res.ref))).toBeLessThanOrEqual(2);
  });
});

describe.skipIf(!hasBase)("POST /api/auth/password/reset/confirm/", () => {
  const alice = user("alice");
  const uid = Buffer.from(String(alice.id)).toString("base64url");
  const bodies = [
    {},
    { uid, token: "", new_password: "x" },
    { uid, token: "abc-123", new_password: "Correct-Horse-9" },
    { uid: "!!!", token: "abc-123", new_password: "Correct-Horse-9" },
    { uid: Buffer.from("99999").toString("base64url"), token: "abc-123", new_password: "Correct-Horse-9" },
    { uid, token: "zzzzzz-0123456789abcdef0123456789abcdef", new_password: "Correct-Horse-9" },
  ];

  it.each(bodies.map((b, i) => [i, b]))("contract + twin: rejected body #%s", async (_i, body) => {
    const res = await call("anonymous", { method: "POST", path: "/api/auth/password/reset/confirm/", body });
    expect(res.status).toBe(400);
    expectSchema(PasswordResetConfirmResponse, res.body);
    await expectTwin("anonymous", { method: "POST", path: "/api/auth/password/reset/confirm/", body }, {
      project: ["status", "message"],
      refStable: false,
    });
  });
});
