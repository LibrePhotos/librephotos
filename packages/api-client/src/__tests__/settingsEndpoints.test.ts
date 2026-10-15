/**
 * The settings endpoints the web and mobile apps share (issue #2347): the request each one sends
 * and the parsed answer, against the backend's answers.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { PredefinedBurstRules, PredefinedRules } from "../schemas";
import { ResponseParseError } from "../util/parse";
import { defined } from "./defined";
import emailConfig from "./fixtures/emailConfig.json";
import predefinedBurstRules from "./fixtures/predefinedBurstRules.json";
import predefinedRules from "./fixtures/predefinedRules.json";
import siteSettings from "./fixtures/siteSettings.json";
import { fakeServer } from "./harness";

describe("site settings", () => {
  it("parses what GET /api/sitesettings answers", async () => {
    const { client, requests } = fakeServer(siteSettings);
    const settings = await endpoints.fetchSiteSettings(client);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/sitesettings");
    expect(settings.ocr_model).toBe("ppocrv6_small");
    expect(settings.auto_create_user_directory).toBe(true);
  });

  it("yields usable settings from a backend without OCR or user folders, and without llm_model", async () => {
    const { ocr_model: _ocr, auto_create_user_directory: _folders, ...older } = siteSettings;
    await expect(endpoints.fetchSiteSettings(fakeServer(older).client)).resolves.toMatchObject({
      ocr_model: "none",
      auto_create_user_directory: false,
    });
    const { llm_model: _llm, ...withoutLlm } = siteSettings;
    await expect(endpoints.fetchSiteSettings(fakeServer(withoutLlm).client)).resolves.not.toHaveProperty("llm_model");
  });

  it("posts only the changed keys and parses the settings back", async () => {
    const { client, requests } = fakeServer({ ...siteSettings, allow_upload: false });
    const settings = await endpoints.updateSiteSettings(client, { allow_upload: false });
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/sitesettings",
      method: "POST",
      body: { allow_upload: false },
    });
    expect(settings.allow_upload).toBe(false);
  });

  it("parses the staff-only feature switches and model download", async () => {
    const on = { enabled: true, locked: false, model_ready: null };
    const staff = {
      ...siteSettings,
      features: {
        video: on,
        face_detection: { enabled: true, locked: false, model_ready: false },
        face_cluster: on,
        image_captioning: { enabled: false, locked: true, model_ready: true },
        reverse_geocoding: on,
        scene_classification: { enabled: true, locked: false, model_ready: true },
        video_previews: { enabled: false, locked: false, model_ready: null },
      },
      model_download: { id: 7, status: "running", progress_current: 2, progress_target: 12 },
    };
    const settings = await endpoints.fetchSiteSettings(fakeServer(staff).client);
    expect(settings.features?.image_captioning).toEqual({ enabled: false, locked: true, model_ready: true });
    expect(settings.model_download?.status).toBe("running");
    expect(settings.features?.video_previews?.enabled).toBe(false);
    // Anonymous and non-staff answers have neither.
    const anonymous = await endpoints.fetchSiteSettings(fakeServer(siteSettings).client);
    expect(anonymous.features).toBeUndefined();
  });

  it("parses the features of a backend without the animated previews switch", async () => {
    const on = { enabled: true, locked: false, model_ready: null };
    const features = {
      video: on,
      face_detection: on,
      face_cluster: on,
      image_captioning: on,
      reverse_geocoding: on,
      scene_classification: on,
    };
    const settings = await endpoints.fetchSiteSettings(fakeServer({ ...siteSettings, features }).client);
    expect(settings.features?.video).toEqual(on);
    expect(settings.features?.video_previews).toBeUndefined();
  });

  it("parses the staff-only automatic scan schedule and its status", async () => {
    const staff = {
      ...siteSettings,
      auto_scan: "custom",
      auto_scan_time: "22:30",
      auto_scan_days: [0, 4],
      auto_scan_status: {
        last_run_at: "2026-10-14T22:30:00Z",
        scanned: ["anna"],
        running: [],
        skipped: ["bob"],
        failed: [],
        next_run_at: null,
        time_zone: "UTC",
      },
    };
    const settings = await endpoints.fetchSiteSettings(fakeServer(staff).client);
    expect(settings.auto_scan_days).toEqual([0, 4]);
    expect(settings.auto_scan_status?.skipped).toEqual(["bob"]);
    // Anonymous answers, and older backends, have none of it.
    const anonymous = await endpoints.fetchSiteSettings(fakeServer(siteSettings).client);
    expect(anonymous.auto_scan).toBeUndefined();
  });

  it("posts the automatic scan's days as a list", async () => {
    const { client, requests } = fakeServer(siteSettings);
    await endpoints.updateSiteSettings(client, { auto_scan: "custom", auto_scan_days: [5, 6] });
    expect(defined(requests[0]).body).toEqual({ auto_scan: "custom", auto_scan_days: [5, 6] });
  });

  it("posts a feature switch as a flat <feature>_enabled boolean", async () => {
    const { client, requests } = fakeServer(siteSettings);
    await endpoints.updateSiteSettings(client, { face_detection_enabled: false });
    expect(defined(requests[0]).body).toEqual({ face_detection_enabled: false });
  });
});

describe("trash retention preview (admin)", () => {
  it("asks for the days and parses the counts", async () => {
    const { client, requests } = fakeServer({ days: 30, photo_count: 1204, user_count: 3 });
    await expect(endpoints.fetchTrashRetentionPreview(client, 30)).resolves.toEqual({
      days: 30,
      photo_count: 1204,
      user_count: 3,
    });
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/sitesettings/trash-retention-preview/?days=30");
  });

  it("rejects an answer without the counts", async () => {
    await expect(endpoints.fetchTrashRetentionPreview(fakeServer({ days: 30 }).client, 30)).rejects.toBeInstanceOf(
      ResponseParseError
    );
  });
});

describe("time zones", () => {
  it("decodes the list the view sends as a JSON string", async () => {
    const { client, requests } = fakeServer(JSON.stringify(["Europe/Berlin", "UTC"]));
    await expect(endpoints.fetchTimezones(client)).resolves.toEqual(["Europe/Berlin", "UTC"]);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/timezones/");
  });

  it("throws a SyntaxError for a string that is no JSON, and a ResponseParseError for no string", async () => {
    await expect(endpoints.fetchTimezones(fakeServer("not json").client)).rejects.toBeInstanceOf(SyntaxError);
    await expect(endpoints.fetchTimezones(fakeServer({ detail: "x" }).client)).rejects.toBeInstanceOf(
      ResponseParseError
    );
  });
});

/**
 * The predefined date-time and burst rules used to be cast. A rule the schema rejected would break
 * the settings page, and a key it does not know would be stripped from the rules users save (the
 * rule schemas are loose, so it is kept). The fixtures are the backend's answers, from
 * PREDEFINED_RULES_JSON in api/metadata/datetime_rules.py and api/stacks/burst_rules.py.
 */
describe("predefined rules", () => {
  it("parse every date-time and burst rule without losing a key", async () => {
    const dateTime = await endpoints.fetchPredefinedRules(fakeServer(JSON.stringify(predefinedRules)).client);
    expect(dateTime).toStrictEqual({ items: predefinedRules, skipped: [], total: 18 });
    const burst = await endpoints.fetchPredefinedBurstRules(fakeServer(JSON.stringify(predefinedBurstRules)).client);
    expect(burst).toStrictEqual({ items: predefinedBurstRules, skipped: [], total: 8 });
    expect(PredefinedRules.parse(predefinedRules)).toStrictEqual(predefinedRules);
    expect(PredefinedBurstRules.parse(predefinedBurstRules)).toStrictEqual(predefinedBurstRules);
  });

  it("keep a key the schemas do not know, such as a param added on the backend later", () => {
    const dateTimeRule = { id: 3, name: "Filename", rule_type: "path", is_default: true, new_param: { x: 1 } };
    const burstRule = { ...defined(predefinedBurstRules[0]), new_param: [1, 2] };
    expect(PredefinedRules.parse([dateTimeRule])).toStrictEqual([dateTimeRule]);
    expect(PredefinedBurstRules.parse([burstRule])).toStrictEqual([burstRule]);
  });

  it("skip a date-time rule of a type this client does not know, keep the rest and say why", async () => {
    const userDefined = { id: 14, name: "Timestamp set by user", rule_type: "user_defined", is_default: true };
    const filename = { id: 3, name: "Filename", rule_type: "path", is_default: true };
    const fromTheFuture = { id: 17, name: "From a newer backend", rule_type: "sidecar_file", is_default: true };
    const { client, requests } = fakeServer(JSON.stringify([userDefined, fromTheFuture, filename]));

    const rules = await endpoints.fetchPredefinedRules(client);

    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/predefinedrules/");
    expect(rules.items).toStrictEqual([userDefined, filename]);
    expect(rules.total).toBe(3);
    expect(rules.skipped).toHaveLength(1);
    expect(defined(rules.skipped[0])).toMatch(/^entry 1: /);
  });

  it("skip a burst rule with an option value this client does not know", async () => {
    const burstMode = defined(predefinedBurstRules[0]);
    const newPattern = { ...burstMode, id: 6, rule_type: "filename_pattern", pattern_type: "pixel_burst" };
    const { client, requests } = fakeServer(JSON.stringify([newPattern, burstMode]));

    const rules = await endpoints.fetchPredefinedBurstRules(client);

    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/predefinedburstrules/");
    expect(rules.items).toStrictEqual([burstMode]);
    expect(rules.skipped).toHaveLength(1);
  });

  it("still fail when the answer is not a list at all", async () => {
    const { client } = fakeServer(JSON.stringify({ detail: "Not found." }));
    await expect(endpoints.fetchPredefinedRules(client)).rejects.toBeInstanceOf(ResponseParseError);
  });
});

describe("email configuration (admin)", () => {
  it("parses the setup with its provider presets", async () => {
    const { client, requests } = fakeServer(emailConfig);
    const config = await endpoints.fetchEmailConfig(client);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/email-config/");
    expect(config.presets.ses?.host).toBeUndefined();
    expect(config.presets.sendgrid?.default_username).toBe("apikey");
  });

  it("posts only the fields to change", async () => {
    const { client, requests } = fakeServer(emailConfig);
    await endpoints.updateEmailConfig(client, { from_email: "photos@example.com", clear_secret: true });
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/email-config/",
      method: "POST",
      body: { from_email: "photos@example.com", clear_secret: true },
    });
  });

  it("sends a test email to an address, or to the admin without one", async () => {
    const answer = { status: true, message: "Test email sent to ann@example.com." };
    const { client, requests } = fakeServer(answer);
    await expect(endpoints.sendTestEmail(client, "ann@example.com")).resolves.toEqual(answer);
    await endpoints.sendTestEmail(client);
    expect(defined(requests[0]).body).toEqual({ to: "ann@example.com" });
    expect(defined(requests[1])).toEqual({
      url: "https://demo.example.com/api/email-config/test/",
      method: "POST",
      body: {},
    });
  });
});
