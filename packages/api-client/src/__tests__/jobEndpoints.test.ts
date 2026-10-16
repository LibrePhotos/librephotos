/**
 * The job endpoints the web and mobile apps share (issue #2347): the list, one job, cancel and
 * delete, the job triggers, and zip downloads. The answers are what the backend sent in a test
 * run (api/views/jobs.py, scan_triggers.py, zip_downloads.py).
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { ResponseParseError } from "../util/parse";
import { defined } from "./defined";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";

const job = {
  job_id: "c7cd8ecf-0491-4592-93ee-08f408f7a75d",
  queued_at: "2026-10-12T18:39:50.389371Z",
  finished: false,
  finished_at: null,
  started_at: null,
  failed: false,
  cancelled: false,
  job_type_str: "Scan Photos",
  job_type: 1,
  started_by: { id: 1, username: "admin", first_name: "Ada", last_name: "Admin" },
  progress_current: 0,
  progress_target: 0,
  progress_step: null,
  result: null,
  is_scan_baseline: false,
  id: 1,
};

const alreadyRunning = {
  errors: [{ field: "detail", message: "Scan Photos is already running.", code: "job_already_running", job_id: "j0" }],
};

describe("job list and detail", () => {
  it("asks for one page, and for the caller's own jobs only when narrowing", async () => {
    const page = { count: 1, next: null, previous: null, results: [job], page: 1, page_size: 10, num_pages: 1 };
    const { client, requests } = fakeServer(page);
    const jobs = await endpoints.fetchJobs(client, 0, 10);
    await endpoints.fetchJobs(client, 2, 10, { mine: true });
    expect(requests.map(request => request.url)).toEqual([
      `${API}/jobs/?page=0&page_size=10`,
      `${API}/jobs/?page=2&page_size=10&mine=true`,
    ]);
    expect(defined(jobs.results[0]).job_type_str).toBe("Scan Photos");
  });

  it("reads which job is the scan baseline, and a server that does not say", async () => {
    const { is_scan_baseline: _dropped, ...fromAnOlderServer } = job;
    const results = [{ ...job, finished: true, is_scan_baseline: true }, fromAnOlderServer];
    const page = { count: 2, next: null, previous: null, results, page: 1, page_size: 10, num_pages: 1 };
    const { client } = fakeServer(page);
    const jobs = await endpoints.fetchJobs(client, 0, 10);
    expect(jobs.results.map(row => row.is_scan_baseline)).toEqual([true, undefined]);
  });

  it("reads one job", async () => {
    const { client, requests } = fakeServer(job);
    const detail = await endpoints.fetchJob(client, 1);
    expect(defined(requests[0]).url).toBe(`${API}/jobs/1/`);
    expect(detail.finished).toBe(false);
  });

  it("cancels a job and reads it back nested in the answer", async () => {
    const answer = { status: true, job: { ...job, finished: true, cancelled: true, result: { status: "cancelled" } } };
    const { client, requests } = fakeServer(answer);
    const cancelled = await endpoints.cancelJob(client, 1);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/jobs/1/cancel/`, method: "POST", body: {} });
    expect(cancelled.job?.cancelled).toBe(true);
  });

  it("deletes a job (204)", async () => {
    const { client, requests } = fakeServer(null);
    await endpoints.deleteJob(client, 1);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/jobs/1/`, method: "DELETE" });
  });
});

describe("job triggers", () => {
  const started = { status: true, job_id: "j1", job_ids: ["j1"] };

  it.each([
    ["scanNextcloudPhotos", "/nextcloud/scanphotos/", endpoints.scanNextcloudPhotos],
    ["generateEventAlbums", "/autoalbumgen/", endpoints.generateEventAlbums],
    ["regenerateEventAlbumTitles", "/autoalbumtitlegen/", endpoints.regenerateEventAlbumTitles],
    ["stripThumbnailMetadata", "/strip-thumbnail-metadata/", endpoints.stripThumbnailMetadata],
    ["lookUpPlaces", "/look-up-places/", endpoints.lookUpPlaces],
    ["emptyTrash", "/photosedit/empty-trash/", endpoints.emptyTrash],
    ["reapplyDateRules", "/photos/reapply-date-rules/", endpoints.reapplyDateRules],
  ] as const)("%s POSTs %s", async (_name, path, trigger) => {
    const { client, requests } = fakeServer(started);
    const answer = await trigger(client);
    expect(defined(requests[0])).toMatchObject({ url: `${API}${path}`, method: "POST", body: {} });
    expect(answer.job_id).toBe("j1");
  });

  it("sends whether OCR runs over every photo", async () => {
    const { client, requests } = fakeServer(started);
    await endpoints.generateOcr(client, true);
    await endpoints.generateOcr(client, false);
    expect(requests.map(request => request.body)).toEqual([{ full_scan: true }, { full_scan: false }]);
    expect(defined(requests[0]).url).toBe(`${API}/generateocr/`);
  });

  it("sends whether captions are generated for every photo, and reads the model download", async () => {
    const { client, requests } = fakeServer({ ...started, downloads_model: true });
    const answer = await endpoints.generateCaptions(client, true);
    await endpoints.generateCaptions(client, false);
    expect(requests.map(request => request.body)).toEqual([{ full_scan: true }, { full_scan: false }]);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/generate-captions/`, method: "POST" });
    expect(answer).toEqual({ ...started, downloads_model: true });
  });

  it("rescans chosen photos by id and reads how many it covers (#2214)", async () => {
    const { client, requests } = fakeServer({ ...started, photo_count: 2, file_count: 3 });
    const answer = await endpoints.rescanPhotos(client, ["p1", "p2"]);
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/photos/rescan/`,
      method: "POST",
      body: { photo_ids: ["p1", "p2"] },
    });
    expect(answer).toEqual({ ...started, photo_count: 2, file_count: 3 });
  });

  it("scans files by path and reads the paths it left out (#900)", async () => {
    const { client, requests } = fakeServer({ ...started, file_count: 1, ignored_paths: ["/etc/passwd"] });
    const answer = await endpoints.scanFiles(client, ["/data/alice/a.jpg", "/etc/passwd"]);
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/scan-files/`,
      body: { paths: ["/data/alice/a.jpg", "/etc/passwd"] },
    });
    expect(answer).toEqual({ ...started, file_count: 1, ignored_paths: ["/etc/passwd"] });
  });

  it("follows the job already running instead of failing on a 409", async () => {
    for (const trigger of [
      endpoints.scanNextcloudPhotos,
      endpoints.generateEventAlbums,
      endpoints.regenerateEventAlbumTitles,
      endpoints.stripThumbnailMetadata,
      endpoints.lookUpPlaces,
      endpoints.emptyTrash,
      endpoints.reapplyDateRules,
      (client: Parameters<typeof endpoints.rescanPhotos>[0]) => endpoints.rescanPhotos(client, ["p1"]),
      (client: Parameters<typeof endpoints.scanFiles>[0]) => endpoints.scanFiles(client, ["/a.jpg"]),
      (client: Parameters<typeof endpoints.generateOcr>[0]) => endpoints.generateOcr(client, false),
      (client: Parameters<typeof endpoints.generateCaptions>[0]) => endpoints.generateCaptions(client, false),
      endpoints.detectStacks,
      endpoints.detectDuplicates,
      endpoints.writeMetadataToFiles,
    ]) {
      const { client } = fakeServer(alreadyRunning, 409);
      await expect(trigger(client)).resolves.toEqual({ status: true, job_id: "j0", already_running: true });
    }
  });

  it("writes the existing edits to files: everything the settings write, or the given types", async () => {
    const queued = { job_id: "j3", types: ["ratings", "dates"] };
    const { client, requests } = fakeServer(queued, 202);
    expect(await endpoints.writeMetadataToFiles(client)).toEqual(queued);
    await endpoints.writeMetadataToFiles(client, ["ratings"]);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/savemetadata/`, method: "POST", body: {} });
    expect(defined(requests[1]).body).toEqual({ types: ["ratings"] });
  });

  it("reads what writing the existing edits would write", async () => {
    const preview = {
      target: "sidecar",
      counts: [
        { type: "ratings", photos: 1284 },
        { type: "dates", photos: 12 },
      ],
      total: 1290,
    };
    const { client, requests } = fakeServer(preview);
    expect(await endpoints.fetchWriteMetadataPreview(client)).toEqual(preview);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/savemetadata/`, method: "GET" });

    const off = fakeServer({ target: null, counts: [], total: 0 });
    expect((await endpoints.fetchWriteMetadataPreview(off.client)).target).toBeNull();
  });

  it("starts stack and duplicate detection with their options", async () => {
    const queued = {
      status: "queued",
      message: "Stack detection started",
      options: { detect_bursts: true },
      job_id: "j2",
    };
    const { client, requests } = fakeServer(queued);
    expect(await endpoints.detectStacks(client)).toEqual(queued);
    await endpoints.detectDuplicates(client, { detect_exact_copies: true, visual_threshold: 8 });
    expect(requests.map(({ url, body }) => ({ url, body }))).toEqual([
      { url: `${API}/stacks/detect/`, body: {} },
      { url: `${API}/duplicates/detect`, body: { detect_exact_copies: true, visual_threshold: 8 } },
    ]);
  });

  it("rejects a detection answer it cannot read", async () => {
    const { client } = fakeServer({ status: true });
    await expect(endpoints.detectStacks(client)).rejects.toBeInstanceOf(ResponseParseError);
  });
});

describe("zip downloads", () => {
  const uuid = "0b4f4c5e-6f1a-4c55-9d3e-8a7b6c5d4e3f";

  it("starts an archive of photos by hash", async () => {
    const { client, requests } = fakeServer({ job_id: "j3", url: uuid });
    const start = await endpoints.startPhotoDownload(client, ["a", "b"]);
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/photos/download`,
      method: "POST",
      body: { image_hashes: ["a", "b"], include_stacked_photos: false },
    });
    expect(start).toEqual({ job_id: "j3", url: uuid });
  });

  it("starts an archive of a selected-all set with the stacked photos", async () => {
    const { client, requests } = fakeServer({ job_id: "j3", url: uuid });
    await endpoints.startPhotoDownload(client, [], {
      selectAll: { query: { favorite: true }, excludedHashes: ["x"] },
      includeStackedPhotos: true,
    });
    expect(defined(requests[0]).body).toEqual({
      select_all: true,
      query: { favorite: true },
      excluded_hashes: ["x"],
      include_stacked_photos: true,
    });
  });

  it("asks for the archive job's status and deletes the archive", async () => {
    const { client, requests } = fakeServer({ status: "PENDING", progress: null }, 202);
    expect((await endpoints.fetchPhotoDownloadStatus(client, "j3")).status).toBe("PENDING");
    await endpoints.deletePhotoDownload(client, uuid);
    expect(requests.map(({ url, method }) => `${method} ${url}`)).toEqual([
      `GET ${API}/photos/download?job_id=j3`,
      `DELETE ${API}/delete/zip/${uuid}`,
    ]);
  });
});

describe("upgrade tasks (#2322)", () => {
  const task = {
    key: "probe_videos",
    kind: "action",
    optional: true,
    status: "running",
    count: 120,
    progress_current: 40,
    progress_target: 120,
    latest_job_id: 7,
    error: null,
    completed_at: null,
  };

  it("reads the card's tasks", async () => {
    const { client, requests } = fakeServer({ tasks: [task] });
    const answer = await endpoints.fetchUpgradeTasks(client);
    expect(defined(requests[0]).url).toBe(`${API}/upgrade-tasks/`);
    expect(answer.tasks).toEqual([task]);
  });

  it("refuses a status this client does not know", async () => {
    const { client } = fakeServer({ tasks: [{ ...task, status: "paused" }] });
    await expect(endpoints.fetchUpgradeTasks(client)).rejects.toBeInstanceOf(ResponseParseError);
  });

  it("starts a task, and follows its job when it already runs", async () => {
    const { client, requests } = fakeServer({
      status: true,
      job_id: "j1",
      job_ids: ["j1"],
    });
    const answer = await endpoints.startUpgradeTask(client, "probe_videos");
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/upgrade-tasks/probe_videos/start/`,
      method: "POST",
    });
    expect(answer.job_id).toBe("j1");

    const running = fakeServer(alreadyRunning, 409);
    await expect(endpoints.startUpgradeTask(running.client, "probe_videos")).resolves.toEqual({
      status: true,
      job_id: "j0",
      already_running: true,
    });
  });

  it("dismisses an optional task and reads the tasks left", async () => {
    const { client, requests } = fakeServer({ tasks: [] });
    const answer = await endpoints.dismissUpgradeTask(client, "probe_videos");
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/upgrade-tasks/probe_videos/dismiss/`,
      method: "POST",
    });
    expect(answer.tasks).toEqual([]);
  });
});
