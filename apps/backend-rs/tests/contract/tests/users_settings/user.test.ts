// Area users_settings: /api/user/, /api/user/{id}/, /api/manage/user/{id}/,
// /api/delete/user/{id}/, /api/firsttimesetup/.
// Mutations here are idempotent (the profile sent back unchanged) or rejected
// before anything is written, so they are safe on the shared read-only clones.
import { ManageUser, User } from "@fe/user/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { BASE_URL, hasBase, REF_URL } from "../../src/env";
import { manifest, ROLES, user, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { FirstTimeSetupResponse, UserListResponse } from "../../src/schemas/users_settings";
import { expectTwin } from "../../src/twin";

const FULL_USER_FIELDS = [
  "id",
  "username",
  "email",
  "scan_directory",
  "confidence",
  "confidence_person",
  "transcode_videos",
  "semantic_search_topk",
  "first_name",
  "public_photo_samples[].*",
  "last_name",
  "public_photo_count",
  "date_joined",
  "avatar",
  "is_superuser",
  "photo_count",
  "nextcloud_server_address",
  "nextcloud_username",
  "nextcloud_scan_directory",
  "avatar_url",
  "favorite_min_rating",
  "image_scale",
  "text_alignment",
  "header_size",
  "save_metadata_to_disk",
  "save_face_tags_to_disk",
  "datetime_rules",
  "burst_detection_rules",
  "llm_settings",
  "default_timezone",
  "public_sharing",
  "public_sharing_defaults",
  "min_cluster_size",
  "confidence_unknown_face",
  "min_samples",
  "cluster_selection_epsilon",
  "skip_raw_files",
  "stack_raw_jpeg",
  "slideshow_interval",
  "duplicate_sensitivity",
  "duplicate_clear_existing",
];

const PUBLIC_USER_FIELDS = [
  "id",
  "avatar_url",
  "username",
  "first_name",
  "last_name",
  "public_photo_count",
  "public_photo_samples[].*",
  "public_sharing",
];

const LIST_FIELDS = ["count", "next", "previous", ...FULL_USER_FIELDS.map(f => `results[].${f}`)];

describe.skipIf(!hasBase)("GET /api/user/", () => {
  it.each(ROLES)("contract: parses with UserListResponse as %s", async role => {
    const res = await call(role, { path: "/api/user/" });
    expect(res.status).toBe(200);
    const page = expectSchema(UserListResponse, res.body);
    if (role === "anonymous") expect(page.results.every(u => u.public_sharing)).toBe(true);
  });

  it.each(ROLES)("twin: whole page as %s", async role => {
    await expectTwin(role, { path: "/api/user/" }, {
      project: LIST_FIELDS,
      unordered: ["results[].public_photo_samples"],
    });
  });

  it("twin: LimitOffset links", async () => {
    for (const query of [{ limit: 2, offset: 2 }, { limit: 2, offset: 1 }, { limit: 0 }, { offset: 9 }]) {
      await expectTwin("alice", { path: "/api/user/", query }, {
        project: ["count", "next", "previous", "results[].id"],
      });
    }
  });

  it("admins see the full profile, others only the public one", async () => {
    const admin = await call<{ results: Record<string, unknown>[] }>("admin", { path: "/api/user/" });
    expect(admin.body.results[0]).toHaveProperty("email");
    const alice = await call<{ results: Record<string, unknown>[] }>("alice", { path: "/api/user/" });
    expect(alice.body.results[0]).not.toHaveProperty("email");
    expect(alice.body.results[0]).not.toHaveProperty("scan_directory");
  });
});

describe.skipIf(!hasBase)("GET /api/user/{id}/", () => {
  it.each(["alice", "bob", "admin", "carol", "dave"] as const)(
    "contract: %s's own details parse with User",
    async role => {
      const me = user(role);
      const res = await call(role, { path: `/api/user/${me.id}/` });
      expect(res.status).toBe(200);
      const parsed = expectSchema(User, res.body);
      expect(parsed.photo_count).toBe(me.photo_count);
    },
  );

  const pairs: [Role, "admin" | "alice" | "bob"][] = [];
  for (const viewer of ROLES) for (const target of ["admin", "alice", "bob"] as const) pairs.push([viewer, target]);
  it.each(pairs)("twin: %s reads %s", async (viewer, target) => {
    const id = user(target).id;
    const full = viewer === "admin" || viewer === target;
    await expectTwin(viewer, { path: `/api/user/${id}/` }, {
      project: full ? FULL_USER_FIELDS : [...PUBLIC_USER_FIELDS, "errors[].*"],
      unordered: ["public_photo_samples"],
    });
  });

  it("twin: unknown, inactive and malformed ids", async () => {
    const deleted = manifest().system_users.deleted!.id;
    for (const path of [`/api/user/99999/`, `/api/user/${deleted}/`, `/api/user/abc/`]) {
      for (const role of ["alice", "admin", "anonymous"] as const) {
        await expectTwin(role, { path }, { project: ["errors[].*"] });
      }
    }
  });
});

describe.skipIf(!hasBase)("PATCH /api/user/{id}/", () => {
  it("contract + twin: the settings page sends the whole profile back", async () => {
    const alice = user("alice");
    const current = await call<Record<string, unknown>>("alice", { path: `/api/user/${alice.id}/` });
    const body = { ...current.body };
    delete body.avatar;
    delete body.scan_directory;
    const res = await call("alice", { method: "PATCH", path: `/api/user/${alice.id}/`, body });
    expect(res.status).toBe(200);
    expectSchema(User, res.body);
    await expectTwin("alice", { method: "PATCH", path: `/api/user/${alice.id}/`, body }, {
      project: FULL_USER_FIELDS,
      unordered: ["public_photo_samples"],
      refStable: false,
    });
  });

  it("twin: PhotoListView sends avatar: null along", async () => {
    const bob = user("bob");
    const current = await call<Record<string, unknown>>("bob", { path: `/api/user/${bob.id}/` });
    await expectTwin("bob", { method: "PATCH", path: `/api/user/${bob.id}/`, body: current.body }, {
      project: FULL_USER_FIELDS,
      refStable: false,
    });
  });

  it("twin: field validation errors", async () => {
    const alice = user("alice");
    const bodies = [
      { email: "not-an-email" },
      { confidence: "abc", semantic_search_topk: 1.5 },
      { header_size: "huge", text_alignment: "center" },
      { default_timezone: "Mars/Olympus" },
      { username: "bob" },
      { username: "has space" },
      { first_name: "x".repeat(151) },
      { transcode_videos: "maybe" },
      { llm_settings: null },
      { avatar: "http://example.com/a.png" },
      { password: "" },
      { nextcloud_server_address: "ftp://nextcloud.example" },
      { nextcloud_server_address: "http://127.0.0.1:8080" },
      { date_joined: "yesterday" },
    ];
    for (const body of bodies) {
      await expectTwin("alice", { method: "PATCH", path: `/api/user/${alice.id}/`, body }, {
        project: ["errors[].*"],
        refStable: false,
      });
    }
  });

  it("authz: only self or staff", async () => {
    const cases: AuthzCase[] = [
      {
        name: "patch bob's profile with nothing",
        req: { method: "PATCH", path: `/api/user/${user("bob").id}/`, body: {} },
        expect: { anonymous: 404, alice: 403, bob: 200, admin: 200 },
      },
      {
        name: "patch an unknown user",
        req: { method: "PATCH", path: "/api/user/99999/", body: {} },
        expect: { anonymous: 404, alice: 404, admin: 404 },
      },
    ];
    for (const c of cases) {
      const matrix = await authzMatrix([c]);
      expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
    }
  });
});

describe.skipIf(!hasBase)("PATCH /api/manage/user/{id}/", () => {
  it("contract + twin: the admin modal sends the row back", async () => {
    const bob = user("bob");
    const list = await call<{ results: Record<string, unknown>[] }>("admin", { path: "/api/user/" });
    const row = list.body.results.find(r => r.id === bob.id)!;
    const body: Record<string, unknown> = { ...row };
    delete body.scan_directory;
    const res = await call("admin", { method: "PATCH", path: `/api/manage/user/${bob.id}/`, body });
    expect(res.status).toBe(200);
    expectSchema(ManageUser, res.body);
    await expectTwin("admin", { method: "PATCH", path: `/api/manage/user/${bob.id}/`, body }, {
      project: [
        "username",
        "scan_directory",
        "skip_raw_files",
        "stack_raw_jpeg",
        "confidence",
        "semantic_search_topk",
        "last_login",
        "date_joined",
        "photo_count",
        "id",
        "favorite_min_rating",
        "image_scale",
        "save_metadata_to_disk",
        "email",
        "first_name",
        "last_name",
      ],
      refStable: false,
    });
  });

  it("twin: scan directory and username rules", async () => {
    const bob = user("bob");
    const alice = user("alice");
    const bodies = [
      { scan_directory: "C:/Windows" },
      { scan_directory: alice.scan_directory },
      { scan_directory: `${bob.scan_directory}/does-not-exist` },
      { scan_directory: null },
      { username: "alice" },
      { username: "" },
      { stack_raw_jpeg: "nope" },
    ];
    for (const body of bodies) {
      await expectTwin("admin", { method: "PATCH", path: `/api/manage/user/${bob.id}/`, body }, {
        project: ["errors[].*"],
        refStable: false,
      });
    }
  });

  it("authz: IsAdminUser", async () => {
    const c: AuthzCase = {
      name: "manage patch",
      req: { method: "PATCH", path: `/api/manage/user/${user("bob").id}/`, body: {} },
      expect: { anonymous: 401, alice: 403, bob: 403, admin: 200 },
    };
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
    await expectTwin("admin", { method: "PATCH", path: "/api/manage/user/99999/", body: {} }, {
      project: ["errors[].*"],
      refStable: false,
    });
  });
});

describe.skipIf(!hasBase)("DELETE /api/delete/user/{id}/ (non-destructive cases)", () => {
  it("authz: superuser only, never a superuser, 404 for unknown ids", async () => {
    const cases: AuthzCase[] = [
      {
        name: "delete bob as someone else",
        req: { method: "DELETE", path: `/api/delete/user/${user("bob").id}/` },
        roles: ["anonymous", "alice", "bob", "carol", "dave"],
        expect: { anonymous: 401, alice: 403, bob: 403 },
      },
      {
        name: "delete the superuser",
        req: { method: "DELETE", path: `/api/delete/user/${user("admin").id}/` },
        roles: ["admin"],
        expect: { admin: 400 },
      },
      {
        name: "delete an unknown user",
        req: { method: "DELETE", path: "/api/delete/user/99999/" },
        roles: ["admin"],
        expect: { admin: 404 },
      },
    ];
    for (const c of cases) {
      const matrix = await authzMatrix([c]);
      expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
    }
  });
});

describe.skipIf(!hasBase)("POST /api/user/ (rejected before any write)", () => {
  it("authz: registration closed and setup done", async () => {
    const c: AuthzCase = {
      name: "sign up",
      req: { method: "POST", path: "/api/user/", body: {} },
      expect: { anonymous: 401, alice: 403, bob: 403 },
    };
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });

  it("twin: admin create validation", async () => {
    for (const body of [
      {},
      { username: "x y", password: "pw" },
      { username: "alice", password: "pw" },
      { username: "newbie", password: "pw", email: "nope" },
      { username: "newbie", password: "pw", scan_directory: "C:/Windows" },
    ]) {
      await expectTwin("admin", { method: "POST", path: "/api/user/", body }, {
        project: ["errors[].*"],
        refStable: false,
      });
    }
  });
});

describe.skipIf(!hasBase)("GET /api/firsttimesetup/", () => {
  it.each(ROLES)("contract + twin as %s", async role => {
    const res = await call(role, { path: "/api/firsttimesetup/" });
    expectSchema(FirstTimeSetupResponse, res.body);
    await expectTwin(role, { path: "/api/firsttimesetup/" }, { project: ["isFirstTimeSetup"] });
  });

  it("a bad bearer token is a 401 even here", async () => {
    // simplejwt adds a `messages` entry the foundation's 401 does not carry,
    // so only the status and the first error field are compared.
    const req = { path: "/api/firsttimesetup/", headers: { Authorization: "Bearer nope" } };
    const ref = await call<{ errors: { field: string }[] }>("anonymous", req, REF_URL);
    const actual = await call<{ errors: { field: string }[] }>("anonymous", req, BASE_URL);
    expect(actual.status).toBe(ref.status);
    expect(actual.body.errors[0]?.field).toBe(ref.body.errors[0]?.field);
  });
});
