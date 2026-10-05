// Which credentials these API views accept. They use DRF's default
// authentication (simplejwt JWTAuthentication): an `Authorization: Bearer`
// header, with the scheme spelled exactly so. The ambient `jwt` cookie counts
// on media and upload views only, so here it authenticates nobody.
import { describe, expect, it } from "vitest";

import { login } from "../../src/client";
import { hasBase, REF_URL } from "../../src/env";
import { manifest } from "../../src/manifest";
import { expectTwin } from "../../src/twin";

const PRIVATE = [
  "/api/photos/searchlist/?search=a",
  "/api/searchtermexamples/",
  "/api/photos/shared/tome/",
  "/api/photos/shared/fromme/",
  "/api/geocode/search?q=",
];

const PUBLIC = (): string[] => [
  `/api/public/albums/s/${manifest().shares.public_album.slug}/`,
  `/api/public/photo/${manifest().shares.photo_share.slug}/`,
];

async function bobAccess(): Promise<string> {
  return (await login("bob", REF_URL)).access;
}

describe.skipIf(!hasBase)("auth: DRF default authentication", () => {
  it.each(PRIVATE)("twin: a valid token in the jwt cookie alone is a 401 on %s", async path => {
    const { actual } = await expectTwin(
      "anonymous",
      { path, headers: { Cookie: `jwt=${await bobAccess()}` } },
      { project: ["__status_only__"] },
    );
    expect(actual.status).toBe(401);
  });

  it.each(PRIVATE)("twin: a lowercase bearer scheme is not simplejwt's (401) on %s", async path => {
    const { actual } = await expectTwin(
      "anonymous",
      { path, headers: { Authorization: `bearer ${await bobAccess()}` } },
      { project: ["__status_only__"] },
    );
    expect(actual.status).toBe(401);
  });

  it.each(PRIVATE)("twin: the Bearer header still works on %s", async path => {
    const { actual } = await expectTwin(
      "anonymous",
      { path, headers: { Authorization: `Bearer ${await bobAccess()}` } },
      { project: ["__status_only__"] },
    );
    expect(actual.status).toBe(200);
  });

  it("twin: another scheme with a junk token leaves a public page anonymous", async () => {
    for (const path of PUBLIC()) {
      const { actual } = await expectTwin(
        "anonymous",
        { path, headers: { Authorization: "BEARER not-a-token" } },
        { project: ["__status_only__"] },
      );
      expect(actual.status).toBe(200);
    }
  });

  it("twin: a junk jwt cookie leaves a public page anonymous", async () => {
    for (const path of PUBLIC()) {
      const { actual } = await expectTwin(
        "anonymous",
        { path, headers: { Cookie: "jwt=not-a-token" } },
        { project: ["__status_only__"] },
      );
      expect(actual.status).toBe(200);
    }
  });
});
