/**
 * The statistics, server and service endpoints (issue #2347): the request each one sends and the
 * parsed answer, against what api/views/dataviz.py, server_info.py and services.py answered in a
 * test run. The web's statistics page and admin settings use them; mobile does not.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { ServerStats, type LocationSunburst } from "../schemas";
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

  it.each(["start", "stop"] as const)("POSTs a %s", async action => {
    const { client, requests } = fakeServer({ message: `Service ocr ${action}ed successfully` });
    const result = await endpoints.runServiceAction(client, "ocr", action);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/services/ocr/${action}/`, method: "POST" });
    expect(result.message).toContain("ocr");
  });
});
