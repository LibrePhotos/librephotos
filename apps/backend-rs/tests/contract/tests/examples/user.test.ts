// The frontend parses GET /user/{id}/ with this schema (useFetchUserSelfDetailsQuery).
import { User } from "@fe/user/types";
import { describe, expect, it } from "vitest";

import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { user } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

describe.skipIf(!hasBase)("GET /api/user/{id}/", () => {
  it("contract: alice's own details parse with the frontend schema", async () => {
    const alice = user("alice");
    const res = await call("alice", { path: `/api/user/${alice.id}/` });
    expect(res.status).toBe(200);
    const parsed = expectSchema(User, res.body);
    expect(parsed.id).toBe(alice.id);
    expect(parsed.username).toBe("alice");
    expect(parsed.photo_count).toBe(alice.photo_count);
  });

  it("twin: the fields the settings and top bar read match the reference", async () => {
    const alice = user("alice");
    await expectTwin(
      "alice",
      { path: `/api/user/${alice.id}/` },
      {
        project: [
          "id",
          "username",
          "first_name",
          "last_name",
          "email",
          "scan_directory",
          "photo_count",
          "public_photo_count",
          "public_photo_samples[].image_hash",
          "date_joined",
          "is_superuser",
          "favorite_min_rating",
          "save_metadata_to_disk",
          "default_timezone",
          "datetime_rules",
        ],
      },
    );
  });

  it("twin: another user's id as alice, and as anonymous", async () => {
    const bob = user("bob");
    await expectTwin("alice", { path: `/api/user/${bob.id}/` }, { project: ["id", "username"] });
    await expectTwin("anonymous", { path: `/api/user/${bob.id}/` }, { project: [] });
  });
});
