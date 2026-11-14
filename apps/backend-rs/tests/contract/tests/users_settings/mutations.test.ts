// users_settings writes that really change something, sent once to each
// server in the same order: site settings, sign-up with registration open,
// admin create, profile and manage edits, email config, user deletion.
// Only with LP_MUTATION=1 on two fresh clones with their own media copies
// (run_suite.sh mut:users_settings), which then diffs both databases.
import { ManageUser, User } from "@fe/user/types";
import { EmailConfig, SiteSettings } from "@fe/settings/types";
import { describe, expect, it } from "vitest";

import { call } from "../../src/client";
import { BASE_URL, hasBase, REF_URL } from "../../src/env";
import { user } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

const enabled = hasBase && process.env.LP_MUTATION === "1";
const once = { refStable: false } as const;

/** The id `username` got on each server (created in the same order, so equal). */
async function idOf(username: string): Promise<number> {
  const ids = [];
  for (const base of [REF_URL, BASE_URL]) {
    const res = await call<{ results: { id: number; username: string }[] }>("admin", { path: "/api/manage/user/" }, base);
    ids.push(res.body.results.find(u => u.username === username)!.id);
  }
  expect(ids[1]).toBe(ids[0]);
  return ids[0]!;
}

describe.skipIf(!enabled).sequential("users_settings mutations", () => {
  it("POST /api/sitesettings: open registration, close uploads", async () => {
    const body = { allow_registration: true, allow_upload: false, skip_patterns: "tmp,*.bak", map_api_provider: "photon" };
    const { actual } = await expectTwin("admin", { method: "POST", path: "/api/sitesettings", body }, {
      project: ["allow_registration", "allow_upload", "skip_patterns", "map_api_provider"],
      ...once,
    });
    expect(actual.status).toBe(200);
    expectSchema(SiteSettings, actual.body);
    await expectTwin("anonymous", { path: "/api/sitesettings" }, { project: ["allow_registration", "allow_upload"] });
  });

  it("POST /api/user/: anonymous sign-up while registration is open", async () => {
    const body = { username: "newbie", password: "newbie-pw-1", email: "newbie@example.com", first_name: "New", last_name: "Bie" };
    const { actual } = await expectTwin("anonymous", { method: "POST", path: "/api/user/", body }, {
      project: ["id", "username", "email", "first_name", "last_name", "errors[].*"],
      ...once,
    });
    expect(actual.status).toBe(201);
  });

  it("POST /api/user/: admin creates a user", async () => {
    const body = { username: "made_by_admin", password: "admin-made-pw", email: "made@example.com" };
    const { actual } = await expectTwin("admin", { method: "POST", path: "/api/user/", body }, {
      project: ["id", "username", "email", "first_name", "last_name", "scan_directory", "errors[].*"],
      ...once,
    });
    expect(actual.status).toBe(201);
  });

  it("the new users can sign in on both servers", async () => {
    for (const base of [REF_URL, BASE_URL]) {
      const res = await fetch(`${base}/api/auth/token/obtain/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "newbie", password: "newbie-pw-1" }),
      });
      expect(res.status, base).toBe(200);
    }
  });

  it("PATCH /api/user/{id}/: alice changes her settings", async () => {
    const alice = user("alice");
    const body = {
      first_name: "Alicia",
      confidence: 0.3,
      confidence_person: 0.8,
      semantic_search_topk: 2,
      favorite_min_rating: 3,
      default_timezone: "Europe/Berlin",
      transcode_videos: true,
      image_scale: 2,
      slideshow_interval: 7,
      public_sharing: false,
    };
    const { actual } = await expectTwin("alice", { method: "PATCH", path: `/api/user/${alice.id}/`, body }, {
      project: ["id", "username", ...Object.keys(body)],
      ...once,
    });
    expect(actual.status).toBe(200);
    expectSchema(User, actual.body);
  });

  it("PATCH /api/manage/user/{id}/: admin edits bob", async () => {
    const bob = user("bob");
    const body = { first_name: "Bobby", email: "bobby@example.com", favorite_min_rating: 5, save_metadata_to_disk: "SIDECAR_FILE" };
    const { actual } = await expectTwin("admin", { method: "PATCH", path: `/api/manage/user/${bob.id}/`, body }, {
      project: ["id", "username", ...Object.keys(body)],
      ...once,
    });
    expect(actual.status).toBe(200);
    expectSchema(ManageUser, actual.body);
  });

  it("POST /api/email-config/: an SMTP server", async () => {
    const body = {
      provider: "custom",
      from_email: "photos@example.com",
      host: "smtp.example.com",
      port: 2525,
      use_tls: false,
      use_ssl: true,
      username: "mailer",
      password: "smtp-secret",
    };
    const fields = ["provider", "from_email", "host", "port", "use_tls", "use_ssl", "username", "has_secret", "is_configured"];
    const { actual } = await expectTwin("admin", { method: "POST", path: "/api/email-config/", body }, { project: fields, ...once });
    expect(actual.status).toBe(200);
    expectSchema(EmailConfig, actual.body);
    await expectTwin("admin", { path: "/api/email-config/" }, { project: fields });
    await expectTwin("anonymous", { path: "/api/sitesettings" }, { project: ["email_configured"] });
  });

  it("DELETE /api/delete/user/{id}/: the sign-up and dave (with his photo)", async () => {
    for (const username of ["newbie", "dave"]) {
      const id = await idOf(username);
      const { actual } = await expectTwin("admin", { method: "DELETE", path: `/api/delete/user/${id}/` }, { project: ["*"], ...once });
      expect(actual.status).toBeLessThan(300);
      await expectTwin("admin", { path: `/api/manage/user/${id}/` }, { project: ["errors[].*"] });
    }
  });
});
