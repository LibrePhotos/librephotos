/**
 * The error report endpoints (#2938): the Error reports page's calls and the web app's forwarder,
 * against what api/views/error_reports.py answers.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { defined } from "./defined";
import siteSettings from "./fixtures/siteSettings.json";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";

const report = {
  id: 3,
  source: "browser",
  title: "TypeError: Cannot read properties of undefined (reading 'name')",
  level: "error",
  release: "2026w44",
  occurrences: 2,
  first_seen: "2026-11-08T10:15:02.123456Z",
  last_seen: "2026-11-08T11:00:00Z",
  sent_at: null,
};

describe("error reports", () => {
  it("lists the saved reports", async () => {
    const { client, requests } = fakeServer([report, { ...report, id: 4, sent_at: "2026-11-08T12:00:00Z" }]);
    const reports = await endpoints.fetchErrorReports(client);
    expect(defined(requests[0]).url).toBe(`${API}/error-reports/`);
    expect(reports.map(row => row.sent_at)).toEqual([null, "2026-11-08T12:00:00Z"]);
  });

  it("reads an id an older server sent as a string", async () => {
    const [row] = await endpoints.fetchErrorReports(fakeServer([{ ...report, id: "3" }]).client);
    expect(defined(row).id).toBe(3);
  });

  it("sends one and parses the report back", async () => {
    const sent = { ...report, sent_at: "2026-11-08T12:00:00Z" };
    const { client, requests } = fakeServer(sent);
    await expect(endpoints.sendErrorReport(client, 3)).resolves.toEqual(sent);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/error-reports/3/send/`, method: "POST" });
  });

  it("sends all", async () => {
    const { client, requests } = fakeServer({ sent: 2, failed: 1 });
    await expect(endpoints.sendAllErrorReports(client)).resolves.toEqual({ sent: 2, failed: 1 });
    expect(defined(requests[0])).toMatchObject({ url: `${API}/error-reports/send/`, method: "POST" });
  });

  it("deletes one and all", async () => {
    const { client, requests } = fakeServer(null);
    await endpoints.deleteErrorReport(client, 3);
    await endpoints.deleteAllErrorReports(client);
    expect(requests.map(({ url, method }) => [method, url])).toEqual([
      ["DELETE", `${API}/error-reports/3/`],
      ["DELETE", `${API}/error-reports/`],
    ]);
  });

  it("downloads one as a file", async () => {
    const { client, requests } = fakeServer({ event_id: "abc", level: "error" });
    const file = await endpoints.downloadErrorReport(client, 3);
    expect(defined(requests[0]).url).toBe(`${API}/error-reports/3/download/`);
    expect(JSON.parse(await file.text())).toEqual({ event_id: "abc", level: "error" });
  });

  it("forwards a browser envelope as text", async () => {
    const { client, requests } = fakeServer({ saved: 1 });
    await expect(endpoints.forwardBrowserErrorReport(client, '{"event_id":"a"}\n')).resolves.toEqual({ saved: 1 });
    expect(defined(requests[0])).toEqual({
      url: `${API}/error-reports/browser/`,
      method: "POST",
      body: { envelope: '{"event_id":"a"}\n' },
    });
  });

  it("reads the error reporting choice from the staff site settings", async () => {
    const staff = {
      ...siteSettings,
      error_reporting: "off",
      error_reporting_own_server: false,
      error_reporting_maintainers: true,
    };
    const settings = await endpoints.fetchSiteSettings(fakeServer(staff).client);
    expect(settings).toMatchObject({ error_reporting: "off", error_reporting_maintainers: true });
    const anonymous = await endpoints.fetchSiteSettings(fakeServer(siteSettings).client);
    expect(anonymous.error_reporting).toBeUndefined();
  });
});
