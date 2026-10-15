/**
 * The statistics, server and service endpoints (issue #2347): the request each one sends and the
 * parsed answer, against what api/views/dataviz.py, server_info.py and services.py answered in a
 * test run. The web's statistics page and admin settings use them; mobile does not.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { ServerStats, type LocationSunburst } from "../schemas";
import { createApiClient } from "../transport";
import { defined } from "./defined";
import locationSunburst from "./fixtures/locationSunburst.json";
import serverStats from "./fixtures/serverStats.json";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";

const countStats = {
  num_photos: 12,
  num_missing_photos: 0,
  num_faces: 6,
  num_people: 2,
  num_unknown_faces: 1,
  num_labeled_faces: 3,
  num_inferred_faces: 2,
  num_albumauto: 1,
  num_albumdate: 4,
  num_albumuser: 1,
  num_screenshots: 1,
  num_documents: 0,
};

describe("statistics", () => {
  it.each([
    ["fetchCountStats", "/stats/", countStats, endpoints.fetchCountStats],
    [
      "fetchLocationSunburst",
      "/locationsunburst/",
      { name: "Places I've visited", children: [] },
      endpoints.fetchLocationSunburst,
    ],
    ["fetchPhotoMonthCounts", "/photomonthcounts/", [{ month: "2023-1", count: 3 }], endpoints.fetchPhotoMonthCounts],
    [
      "fetchSocialGraph",
      "/socialgraph/",
      { nodes: [{ id: "Alice", x: 1.5, y: -2 }], links: [{ source: "Alice", target: "Bob" }] },
      endpoints.fetchSocialGraph,
    ],
    [
      "fetchWordCloud",
      "/wordcloud/",
      { captions: [{ label: "beach", y: 3 }], people: [], locations: [{ label: "Berlin", y: 8 }] },
      endpoints.fetchWordCloud,
    ],
    [
      "fetchLocationTimeline",
      "/locationtimeline/",
      [{ data: [86400.5], color: "#56db8b", loc: "Berlin", start: 1683280800.0, end: 1683367200.5 }],
      endpoints.fetchLocationTimeline,
    ],
  ])("%s GETs %s", async (_name, path, answer, call) => {
    const { client, requests } = fakeServer(answer);
    await call(client);
    expect(defined(requests[0])).toMatchObject({ url: `${API}${path}`, method: "GET" });
  });

  it("keeps each place's photo count in the location tree (the chart shows it on the leaves)", async () => {
    const { client } = fakeServer(locationSunburst);
    const tree = await endpoints.fetchLocationSunburst(client);
    const leaves = (node: LocationSunburst): LocationSunburst[] =>
      node.children?.length ? node.children.flatMap(leaves) : [node];
    const counts = leaves(tree).map(leaf => leaf.value);
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every(count => typeof count === "number" && count > 0)).toBe(true);
  });

  it("reads the counts and drops the ones it does not show", async () => {
    const { client } = fakeServer(countStats);
    const counts = await endpoints.fetchCountStats(client);
    expect(counts.num_photos).toBe(12);
    expect(counts).not.toHaveProperty("num_screenshots");
  });
});

describe("server", () => {
  it("reads the build tag, also outside Docker where it is blank", async () => {
    const { client, requests } = fakeServer({ image_tag: "", git_hash: "05d973e83" });
    const tag = await endpoints.fetchImageTag(client);
    expect(defined(requests[0]).url).toBe(`${API}/imagetag/`);
    expect(tag.image_tag).toBe("");
  });

  it("reads the storage numbers", async () => {
    const { client, requests } = fakeServer({ total_storage: 100, used_storage: 60, free_storage: 40 });
    const storage = await endpoints.fetchStorageStats(client);
    expect(defined(requests[0]).url).toBe(`${API}/storagestats/`);
    expect(storage.free_storage).toBe(40);
  });

  it("reads real server stats: no GPU gives empty strings, an empty library null minimums", async () => {
    const { client, requests } = fakeServer(serverStats);
    const stats = await endpoints.fetchServerStats(client);
    expect(defined(requests[0]).url).toBe(`${API}/serverstats/`);
    expect(stats.gpu_memory_in_mb).toBe("");
    expect(defined(stats.users[1]).album.min).toBeNull();
  });

  // py-cpuinfo always reports these seven keys and drops every other one it cannot read, or reads
  // as empty or 0: an ARM board without lscpu has no vendor, brand or flags, and a CPU whose model
  // number is 0 has no `model`.
  it("reads CPU info with only the keys py-cpuinfo always reports", () => {
    const cpuInfo = {
      python_version: "3.11.9.final.0 (64 bit)",
      cpuinfo_version: [9, 0, 0],
      cpuinfo_version_string: "9.0.0",
      arch: "ARM_8",
      bits: 64,
      count: 4,
      arch_string_raw: "aarch64",
    };
    expect(ServerStats.safeParse({ ...serverStats, cpu_info: cpuInfo }).success).toBe(true);
  });

  it("takes a GPU's memory as a number", () => {
    const parsed = ServerStats.parse({
      ...serverStats,
      gpu_name: "NVIDIA GeForce GTX 1660 Ti",
      gpu_memory_in_mb: 6144,
    });
    expect(parsed.gpu_memory_in_mb).toBe(6144);
  });

  it("asks for the last lines of the log", async () => {
    const { client, requests } = fakeServer({ logs: "line 0\nline 1\n", count: 2 });
    const logs = await endpoints.fetchServerLogs(client, 100);
    expect(defined(requests[0]).url).toBe(`${API}/serverlogs/view?lines=100`);
    expect(logs.count).toBe(2);
  });

  it("downloads the whole log file as a blob", async () => {
    const { client, requests } = fakeServer("2026-10-12 10:00:00,000 INFO line 0");
    const file = await endpoints.fetchServerLogFile(client);
    expect(defined(requests[0]).url).toBe(`${API}/serverlogs`);
    expect(file).toBeInstanceOf(Blob);
  });
});

describe("services", () => {
  it("lists the services", async () => {
    const { client, requests } = fakeServer({ services: { thumbnail: 8003, ocr: 8012 } });
    const list = await endpoints.fetchServices(client);
    expect(defined(requests[0]).url).toBe(`${API}/services/`);
    expect(Object.keys(list.services)).toEqual(["thumbnail", "ocr"]);
  });

  it("reads a switched-off service's health", async () => {
    const answer = {
      service_name: "image_captioning",
      healthy: false,
      enabled: false,
      feature_flag: "FEATURE_CAPTIONS",
    };
    const { client, requests } = fakeServer(answer);
    const health = await endpoints.fetchServiceHealth(client, "image_captioning");
    expect(defined(requests[0]).url).toBe(`${API}/services/image_captioning/`);
    expect(health).toEqual(answer);
  });

  it("reads a backend's health answer from before the feature flags", async () => {
    const { client } = fakeServer({ service_name: "thumbnail", healthy: true });
    const health = await endpoints.fetchServiceHealth(client, "thumbnail");
    expect(health.enabled).toBeUndefined();
  });

  it("reads why a service cannot start", async () => {
    const answer = {
      service_name: "exif",
      healthy: false,
      enabled: true,
      feature_flag: null,
      port_conflict: "port 8010 is used by python.exe (process ID 4321)",
    };
    const { client } = fakeServer(answer);
    const health = await endpoints.fetchServiceHealth(client, "exif");
    expect(health.port_conflict).toBe(answer.port_conflict);
  });

  it.each(["start", "stop"] as const)("POSTs a %s", async action => {
    const { client, requests } = fakeServer({ message: `Service ocr ${action}ed successfully` });
    const result = await endpoints.runServiceAction(client, "ocr", action);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/services/ocr/${action}/`, method: "POST" });
    expect(result.message).toContain("ocr");
  });
});

/*
 * The readiness probe behind the web's "LibrePhotos is updating" screen (#2310). Today's server
 * answers 200 or 503 `{status: "error", checks}`; the startup placeholder (backend part of #2310)
 * answers 503 with a StartupStatus body while the database updates.
 */
describe("fetchBackendReadiness", () => {
  it("GETs /healthz/ready/ and is ready on a 200", async () => {
    const { client, requests } = fakeServer({
      status: "ok",
      checks: { postgresql: { status: "ok" }, queue: { status: "ok" } },
    });
    expect(await endpoints.fetchBackendReadiness(client)).toEqual({ state: "ready" });
    expect(defined(requests[0]).url).toBe(`${API}/healthz/ready/`);
  });

  it.each(["starting", "updating"] as const)("names the placeholder's %s phase", async status => {
    const { client } = fakeServer({ status, version: "1.4.0" }, 503);
    expect(await endpoints.fetchBackendReadiness(client)).toEqual({
      state: status,
      reasonCode: null,
      version: "1.4.0",
    });
  });

  it("passes a failed update's reason code on", async () => {
    const { client } = fakeServer({ status: "failed", reason_code: "E001" }, 503);
    expect(await endpoints.fetchBackendReadiness(client)).toEqual({
      state: "failed",
      reasonCode: "E001",
      version: null,
    });
  });

  it("reads a failure without a reason code", async () => {
    const { client } = fakeServer({ status: "failed" }, 503);
    expect(await endpoints.fetchBackendReadiness(client)).toMatchObject({
      state: "failed",
      reasonCode: null,
    });
  });

  it.each([
    ["the running server's own 503 (database down)", { status: "error", checks: {} }, 503],
    ["a proxy's 502", { detail: "Bad Gateway" }, 502],
    ["a proxy's 504", { detail: "Gateway Timeout" }, 504],
  ])("is unreachable on %s", async (_name, body, status) => {
    const { client } = fakeServer(body, status);
    expect(await endpoints.fetchBackendReadiness(client)).toEqual({
      state: "unreachable",
      reasonCode: null,
      version: null,
    });
  });

  it("is unreachable when nothing answers", async () => {
    const client = createApiClient({
      baseUrl: "https://demo.example.com",
      tokens: {
        getAccessToken: () => null,
        getRefreshToken: () => null,
        setAccessToken: () => {},
        clearTokens: () => {},
      },
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    expect(await endpoints.fetchBackendReadiness(client)).toMatchObject({
      state: "unreachable",
    });
  });

  // Something answers for the server, so the app's own error handling takes over.
  it.each([404, 500])("is ready on a %i", async status => {
    const { client } = fakeServer({ errors: [] }, status);
    expect(await endpoints.fetchBackendReadiness(client)).toEqual({ state: "ready" });
  });
});
