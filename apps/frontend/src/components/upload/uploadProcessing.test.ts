import type { ImportJob, UploadStatus } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import {
  absorbStatus,
  followedJobIds,
  importCounts,
  NO_OUTCOMES,
  pendingUploads,
  processingPhase,
  rowServerState,
  type ServerOutcomes,
} from "./uploadProcessing";
import type { UploadItem } from "./useUploadQueue";

const file = new File([new Uint8Array(4)], "a.jpg", { type: "image/jpeg" });
const row = (id: string, patch: Partial<UploadItem> = {}): UploadItem => ({
  id,
  file,
  status: "done",
  progress: 100,
  ...patch,
});
const uploaded = (photoId: string, jobId = "j1"): UploadItem & { jobId: string; photoId: string } => ({
  ...row(photoId),
  jobId,
  photoId,
});

const job = (job_id: string, patch: Partial<ImportJob> = {}): ImportJob => ({
  id: 1,
  job_id,
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
  progress_target: 0,
  result: { stages: {} },
  ...patch,
});

const status = (imports: ImportJob[], patch: Partial<UploadStatus> = {}): UploadStatus => ({
  imports,
  ready_photo_ids: [],
  followups: { state: "idle", next_run_at: null },
  ...patch,
});

const outcomes = (patch: Partial<ServerOutcomes>): ServerOutcomes => ({ ...NO_OUTCOMES, ...patch });
const failure = (photo_id: string, stage: string) => ({ photo_id, file: "a.jpg", stage, error: "boom" });

describe("rowServerState", () => {
  it("does not follow a file that is not uploaded, or one the server named no job for", () => {
    expect(rowServerState(row("a", { status: "uploading", jobId: "j1", photoId: "p" }), NO_OUTCOMES).kind).toBe(
      "untracked"
    );
    expect(rowServerState(row("a"), NO_OUTCOMES).kind).toBe("untracked");
  });

  it("is processing until the photo is ready, failed to be read, or lost", () => {
    expect(rowServerState(uploaded("p"), NO_OUTCOMES)).toEqual({ kind: "processing" });
    expect(rowServerState(uploaded("p"), outcomes({ ready: new Set(["p"]) }))).toEqual({ kind: "ready" });
    const unreadable = failure("p", "media");
    expect(rowServerState(uploaded("p"), outcomes({ failed: new Map([["p", unreadable]]) }))).toEqual({
      kind: "failed",
      failure: unreadable,
    });
    expect(rowServerState(uploaded("p"), outcomes({ lost: new Set(["p"]) }))).toEqual({ kind: "failed" });
  });

  it("keeps a later step's failure as a problem of a ready photo", () => {
    const faces = failure("p", "faces");
    const known = outcomes({ ready: new Set(["p"]), failed: new Map([["p", faces]]) });
    expect(rowServerState(uploaded("p"), known)).toEqual({ kind: "ready", problem: faces });
    // Not ready yet: it is still processing; its job's end decides.
    expect(rowServerState(uploaded("p"), outcomes({ failed: new Map([["p", faces]]) })).kind).toBe("processing");
  });
});

describe("followed ids", () => {
  it("names each job once and asks only about photos still processing", () => {
    const items = [uploaded("p1"), uploaded("p2", "j2"), uploaded("p3"), row("x")];
    expect(followedJobIds(items)).toEqual(["j1", "j2"]);
    expect(pendingUploads(items, outcomes({ ready: new Set(["p1"]) })).map(item => item.photoId)).toEqual(["p2", "p3"]);
  });

  it("asks about at most 100 photos at once", () => {
    const items = Array.from({ length: 120 }, (_unused, n) => uploaded(`p${n}`));
    expect(pendingUploads(items, NO_OUTCOMES)).toHaveLength(100);
  });
});

describe("absorbStatus", () => {
  const asked = [uploaded("p1"), uploaded("p2"), uploaded("p3", "j2")];

  it("adds ready photos and the failures of every job", () => {
    const answer = status([job("j1", { result: { failed_files: [failure("p2", "media")] } }), job("j2")], {
      ready_photo_ids: ["p1"],
    });
    const next = absorbStatus(NO_OUTCOMES, answer, asked);
    expect([...next.ready]).toEqual(["p1"]);
    expect([...next.failed.keys()]).toEqual(["p2"]);
    expect(next.lost.size).toBe(0);
  });

  it("takes a photo whose job finished, or is gone, and that is not ready as lost", () => {
    const answer = status([job("j1", { finished: true })], { ready_photo_ids: ["p1"] });
    expect([...absorbStatus(NO_OUTCOMES, answer, asked).lost]).toEqual(["p2", "p3"]);
  });

  it("gives the same outcomes back when the answer says nothing new", () => {
    const known = outcomes({ ready: new Set(["p1"]) });
    expect(absorbStatus(known, status([job("j1"), job("j2")], { ready_photo_ids: ["p1"] }), asked)).toBe(known);
  });
});

describe("processingPhase", () => {
  const items = [uploaded("p1"), uploaded("p2")];
  const allReady = outcomes({ ready: new Set(["p1", "p2"]) });
  const finished = job("j1", { finished: true, result: { followups_requested: true } });

  it("is untracked without an import job", () => {
    expect(processingPhase([row("a")], NO_OUTCOMES, undefined)).toBe("untracked");
  });

  it("is processing before the first answer, while a photo is unresolved or the job runs", () => {
    expect(processingPhase(items, allReady, undefined)).toBe("processing");
    expect(processingPhase(items, NO_OUTCOMES, status([finished]))).toBe("processing");
    expect(processingPhase(items, allReady, status([job("j1")]))).toBe("processing");
  });

  it("waits for the follow-ups, then is done", () => {
    expect(
      processingPhase(items, allReady, status([finished], { followups: { state: "pending", next_run_at: null } }))
    ).toBe("followups");
    expect(processingPhase(items, allReady, status([job("j1", { finished: true })]))).toBe("followups");
    expect(processingPhase(items, allReady, status([finished]))).toBe("done");
  });
});

describe("importCounts", () => {
  it("sums the jobs, clamps the count at the target and leaves out the failures", () => {
    const jobs = [
      job("j1", { progress_current: 5, progress_target: 4, result: { error_count: 1 } }),
      job("j2", { progress_current: 2, progress_target: 6, result: { failed_files: [failure("p", "media")] } }),
    ];
    expect(importCounts(jobs)).toEqual({ ready: 4, total: 10 });
    expect(importCounts([])).toEqual({ ready: 0, total: 0 });
  });
});
