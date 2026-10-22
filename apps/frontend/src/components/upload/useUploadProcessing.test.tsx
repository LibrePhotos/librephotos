import type { ImportJob, UploadStatus, UploadStatusParams } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { useUploadProcessing, type UploadProcessing } from "./useUploadProcessing";
import type { UploadItem } from "./useUploadQueue";

type Answer = { data: UploadStatus | undefined; isPlaceholderData: boolean; dataUpdatedAt: number };

const stubs = vi.hoisted(() => ({
  query: vi.fn<(params: UploadStatusParams, isActive: (status: UploadStatus) => boolean) => Answer>(),
  invalidate: vi.fn<() => void>(),
  invalidateProcessed: vi.fn<() => void>(),
}));

vi.mock("../../api_client/upload", () => ({
  useUploadStatusQuery: stubs.query,
  invalidateUploadQueries: stubs.invalidate,
  invalidateProcessedUploads: stubs.invalidateProcessed,
}));

const file = new File([new Uint8Array(4)], "a.jpg", { type: "image/jpeg" });
const uploaded = (photoId: string): UploadItem => ({
  id: photoId,
  file,
  status: "done",
  progress: 100,
  jobId: "j1",
  photoId,
});

const job = (patch: Partial<ImportJob> = {}): ImportJob => ({
  id: 1,
  job_id: "j1",
  queued_at: "2026-10-22T10:00:00Z",
  started_at: null,
  finished_at: null,
  finished: false,
  failed: false,
  cancelled: false,
  job_type: 20,
  job_type_str: "Import Uploads",
  started_by: { id: 1, username: "u", first_name: "", last_name: "" },
  progress_current: 0,
  progress_target: 2,
  result: { stages: {} },
  ...patch,
});

const status = (imports: ImportJob[], ready: string[] = []): UploadStatus => ({
  imports,
  ready_photo_ids: ready,
  followups: { state: "idle", next_run_at: null },
});

let latest: UploadProcessing;
let props: { items: UploadItem[]; isUploading: boolean } = { items: [], isUploading: false };
function Harness() {
  latest = useUploadProcessing(props.items, props.isUploading);
  return null;
}

let root: Root;
let container: HTMLDivElement;
const render = async (items: UploadItem[], answer: Answer, isUploading = false) => {
  props = { items, isUploading };
  stubs.query.mockReturnValue(answer);
  await act(async () => {
    root.render(<Harness />);
  });
};
const answered = (data: UploadStatus, at: number): Answer => ({ data, isPlaceholderData: false, dataUpdatedAt: at });
const lastParams = () => defined(stubs.query.mock.lastCall)[0];
const lastIsActive = () => defined(stubs.query.mock.lastCall)[1];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("useUploadProcessing", () => {
  it("follows nothing without uploads, but lists another device's open import and polls while it runs", async () => {
    const phone = job({ job_id: "phone", progress_current: 1, progress_target: 4 });
    await render([], answered(status([phone, job({ job_id: "old", finished: true })]), 1));

    expect(lastParams()).toEqual({ jobIds: [], photoIds: [] });
    expect(latest.phase).toBe("untracked");
    expect(latest.openImports.map(j => j.job_id)).toEqual(["phone"]);
    expect(lastIsActive()(status([phone]))).toBe(true);
    expect(lastIsActive()(status([]))).toBe(false);
  });

  it("asks about the uploads still processing and refreshes the timeline as photos become ready", async () => {
    const items = [uploaded("p1"), uploaded("p2")];
    await render(items, answered(status([job({ progress_current: 1 })], ["p1"]), 1));

    expect(defined(stubs.query.mock.calls[0])[0]).toEqual({ jobIds: ["j1"], photoIds: ["p1", "p2"] });
    expect([...latest.outcomes.ready]).toEqual(["p1"]);
    expect(latest.phase).toBe("processing");
    expect(latest.counts).toEqual({ ready: 1, total: 2 });
    expect(stubs.invalidate).toHaveBeenCalledTimes(1);
    // The next request asks only about the photo still processing.
    expect(lastParams()).toEqual({ jobIds: ["j1"], photoIds: ["p2"] });
    expect(lastIsActive()(status([]))).toBe(true);
  });

  it("does not take a placeholder answer, which belongs to other photos", async () => {
    await render([uploaded("p1")], { data: status([job()], ["p1"]), isPlaceholderData: true, dataUpdatedAt: 1 });

    expect(latest.outcomes.ready.size).toBe(0);
  });

  it("refreshes the photo lists and albums once processing has ended", async () => {
    const items = [uploaded("p1"), uploaded("p2")];
    await render(items, answered(status([job()]), 1));
    expect(latest.phase).toBe("processing");

    const done = job({ finished: true, progress_current: 2, result: { followups_requested: true } });
    await render(items, answered(status([done], ["p1", "p2"]), 2));

    expect(latest.phase).toBe("done");
    expect(stubs.invalidateProcessed).toHaveBeenCalledTimes(1);
    expect(lastIsActive()(status([done]))).toBe(false);
  });

  it("says how many minutes the server made no progress", async () => {
    const items = [uploaded("p1")];
    // Before the first answer there is no clock to count from.
    await render(items, { data: undefined, isPlaceholderData: false, dataUpdatedAt: 0 });
    await render(items, answered(status([job()]), 1_000));
    expect(latest.stalledMinutes).toBeNull();

    await render(items, answered(status([job()]), 1_000 + 3 * 60_000));
    expect(latest.stalledMinutes).toBe(3);

    // Not while files are still being sent: the upload itself is the progress then.
    await render(items, answered(status([job()]), 1_000 + 4 * 60_000), true);
    expect(latest.stalledMinutes).toBeNull();
  });

  it("starts afresh once the card is closed", async () => {
    await render([uploaded("p1")], answered(status([job()], ["p1"]), 1));
    expect(latest.outcomes.ready.size).toBe(1);

    await render([], answered(status([]), 2));
    expect(latest.outcomes.ready.size).toBe(0);
  });
});
