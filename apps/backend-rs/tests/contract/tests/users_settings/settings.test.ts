// Area users_settings: /api/sitesettings, /api/email-config/ (+ test),
// /api/timezones/, /api/predefinedrules/, /api/predefinedburstrules/,
// /api/dirtree/, /api/nextcloud/*. Writes send the current values back.
import { EmailConfig, SiteSettings, Timezones } from "@fe/settings/types";
import { DirTreeResponse } from "@fe/folders/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { ROLES, user } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import {
  EmailTestResponse,
  PredefinedBurstRule,
  PredefinedDateRule,
} from "../../src/schemas/users_settings";
import { expectTwin } from "../../src/twin";

const SITE_FIELDS = [
  "allow_registration",
  "allow_upload",
  "skip_patterns",
  "heavyweight_process",
  "map_api_provider",
  "map_api_key",
  "map_tile_provider",
  "captioning_model",
  "llm_model",
  "tagging_model",
  "ocr_model",
  "face_recognition_model",
  "nextcloud_enabled",
  "auto_create_user_directory",
  "email_configured",
];

describe.skipIf(!hasBase)("/api/sitesettings", () => {
  it.each(ROLES)("contract + twin: GET as %s", async role => {
    const res = await call(role, { path: "/api/sitesettings" });
    expect(res.status).toBe(200);
    expectSchema(SiteSettings, res.body);
    await expectTwin(role, { path: "/api/sitesettings" }, { project: SITE_FIELDS });
  });

  it("contract + twin: POST the current values back as admin", async () => {
    const current = await call<Record<string, unknown>>("admin", { path: "/api/sitesettings" });
    const body = {
      allow_registration: current.body.allow_registration,
      allow_upload: current.body.allow_upload,
      skip_patterns: current.body.skip_patterns,
      map_api_provider: current.body.map_api_provider,
    };
    const res = await call("admin", { method: "POST", path: "/api/sitesettings", body });
    expect(res.status).toBe(200);
    expectSchema(SiteSettings, res.body);
    await expectTwin("admin", { method: "POST", path: "/api/sitesettings", body }, {
      project: SITE_FIELDS,
      refStable: false,
    });
  });

  it("authz: IsAdminUser on POST", async () => {
    const c: AuthzCase = {
      name: "post site settings",
      req: { method: "POST", path: "/api/sitesettings", body: { allow_upload: true } },
      roles: ["anonymous", "alice", "bob"],
      expect: { anonymous: 401, alice: 403, bob: 403 },
    };
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });

  it("rejects bodies outside the JSON schema (Django: uncaught ValidationError = 500)", async () => {
    for (const body of [{}, { allow_upload: "yes" }, { unknown_key: 1 }]) {
      const res = await call("admin", { method: "POST", path: "/api/sitesettings", body });
      expect(res.status).toBe(400);
    }
  });
});

describe.skipIf(!hasBase)("JSON-encoded string endpoints", () => {
  it.each([
    "/api/timezones/",
    "/api/predefinedrules/",
    "/api/predefinedburstrules/",
    "/api/defaultrules/",
    "/api/defaultburstrules/",
  ])(
    "twin: %s is byte-identical",
    async path => {
      const ref = await call("alice", { path }, process.env.LP_REF_URL ?? process.env.LP_BASE_URL);
      const actual = await call("alice", { path });
      expect(actual.status).toBe(200);
      expect(actual.text).toBe(ref.text);
      expect(typeof actual.body).toBe("string");
    },
  );

  it("contract: the frontend JSON.parses them", async () => {
    const tz = await call<string>("alice", { path: "/api/timezones/" });
    expect(expectSchema(Timezones, JSON.parse(tz.body))).toContain("Europe/Berlin");
    const rules = await call<string>("alice", { path: "/api/predefinedrules/" });
    expectSchema(z.array(PredefinedDateRule), JSON.parse(rules.body));
    const burst = await call<string>("alice", { path: "/api/predefinedburstrules/" });
    expectSchema(z.array(PredefinedBurstRule), JSON.parse(burst.body));
  });

  it("authz: authenticated only", async () => {
    const c: AuthzCase = {
      name: "timezones",
      req: { path: "/api/timezones/" },
      roles: ["anonymous", "alice"],
      expect: { anonymous: 401, alice: 200 },
    };
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});

describe.skipIf(!hasBase)("/api/email-config/", () => {
  const FIELDS = [
    "provider",
    "from_email",
    "host",
    "port",
    "use_tls",
    "use_ssl",
    "username",
    "has_secret",
    "is_configured",
    "presets",
  ];

  it("contract + twin: GET as admin", async () => {
    const res = await call("admin", { path: "/api/email-config/" });
    expect(res.status).toBe(200);
    expectSchema(EmailConfig, res.body);
    await expectTwin("admin", { path: "/api/email-config/" }, { project: FIELDS });
  });

  it("contract + twin: POST the disabled defaults back", async () => {
    const body = { provider: "disabled", from_email: "", host: "", port: 587, use_tls: true, use_ssl: false, username: "" };
    const res = await call("admin", { method: "POST", path: "/api/email-config/", body });
    expect(res.status).toBe(200);
    expectSchema(EmailConfig, res.body);
    await expectTwin("admin", { method: "POST", path: "/api/email-config/", body }, {
      project: FIELDS,
      refStable: false,
    });
  });

  it("twin: test email while email is not configured", async () => {
    const res = await call("admin", { method: "POST", path: "/api/email-config/test/", body: {} });
    expect(res.status).toBe(400);
    expectSchema(EmailTestResponse, res.body);
    await expectTwin("admin", { method: "POST", path: "/api/email-config/test/", body: {} }, {
      project: ["status", "message"],
      refStable: false,
    });
  });

  it("authz: IsAdminUser everywhere", async () => {
    const cases: AuthzCase[] = [
      { name: "get", req: { path: "/api/email-config/" }, expect: { anonymous: 401, alice: 403, admin: 200 } },
      {
        name: "post",
        req: { method: "POST", path: "/api/email-config/", body: {} },
        roles: ["anonymous", "alice", "bob"],
        expect: { anonymous: 401, alice: 403 },
      },
      {
        name: "test",
        req: { method: "POST", path: "/api/email-config/test/", body: {} },
        roles: ["anonymous", "alice", "bob"],
        expect: { anonymous: 401, alice: 403 },
      },
    ];
    for (const c of cases) {
      const matrix = await authzMatrix([c]);
      expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
    }
  });
});

describe.skipIf(!hasBase)("GET /api/dirtree/", () => {
  const root = user("alice").scan_directory.replace(/[\\/][^\\/]+$/, "");
  const paths = [
    undefined,
    root,
    user("alice").scan_directory,
    `${root}\\`,
    `${root}/../..`,
    "C:/Windows",
    `${root}/does-not-exist`,
  ];

  it.each(paths.map(p => [p ?? "(none)", p]))("contract + twin: path=%s", async (_label, path) => {
    const req = { path: "/api/dirtree/", query: path === undefined ? undefined : { path } };
    const res = await call("admin", req);
    if (res.status === 200) expectSchema(DirTreeResponse, res.body);
    await expectTwin("admin", req, { project: ["*"] });
  });

  it("authz: IsAdminUser", async () => {
    const c: AuthzCase = {
      name: "dirtree",
      req: { path: "/api/dirtree/" },
      expect: { anonymous: 401, alice: 403, admin: 200 },
    };
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});

describe.skipIf(!hasBase)("/api/nextcloud/*", () => {
  it("authz: IsAuthenticated + NEXTCLOUD_ENABLED (off in the fixture)", async () => {
    const cases: AuthzCase[] = [
      {
        name: "listdir",
        req: { path: "/api/nextcloud/listdir/", query: { fpath: "/" } },
        expect: { anonymous: 401, alice: 403, admin: 403 },
      },
      {
        name: "scanphotos",
        req: { method: "POST", path: "/api/nextcloud/scanphotos/", body: {} },
        expect: { anonymous: 401, alice: 403, admin: 403 },
      },
    ];
    for (const c of cases) {
      const matrix = await authzMatrix([c]);
      expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
    }
    await expectTwin("alice", { path: "/api/nextcloud/listdir/", query: { fpath: "/" } }, {
      project: ["errors[].*"],
    });
  });
});
