/**
 * The chunked upload endpoints (issue #2347), against what api/views/upload.py and the vendored
 * chunked_upload views answered in a test run: the chunk goes as multipart with a Content-Range
 * header, and the answers are read with their schemas.
 */
import { describe, expect, it, vi } from "vitest";
import * as endpoints from "../endpoints";
import { createApiClient } from "../transport";
import { defined } from "./defined";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";

/** A client that keeps each request's init, headers included (fakeServer keeps only the body). */
function recordingClient(answer: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(
      new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } })
    );
  });
  const client = createApiClient({
    baseUrl: "https://demo.example.com",
    tokens: {
      getAccessToken: () => null,
      getRefreshToken: () => null,
      setAccessToken: () => {},
      clearTokens: () => {},
    },
    fetch: fetchMock,
  });
  return { client, calls };
}

describe("chunked upload", () => {
  it("sends a chunk as multipart with its byte range", async () => {
    const { client, calls } = recordingClient({
      upload_id: "9a4c8032428047ccaee1774c7bb66ecd",
      offset: 677,
      expires: "2026-10-13T19:37:32.909Z",
    });
    const form = new FormData();
    form.append("offset", "0");
    const answer = await endpoints.uploadChunk(client, { form_data: form, offset: 0, chunk_size: 677 });

    const call = defined(calls[0]);
    expect(call.url).toBe(`${API}/upload/`);
    expect(call.init?.method).toBe("POST");
    expect(call.init?.body).toBe(form);
    const headers = new Headers(call.init?.headers);
    expect(headers.get("Content-Range")).toBe("bytes 0-676/677");
    // FormData: the runtime sets the multipart boundary itself.
    expect(headers.get("Content-Type")).toBeNull();
    expect(answer).toEqual({ upload_id: "9a4c8032428047ccaee1774c7bb66ecd", offset: 677 });
  });

  it("rejects a chunk answer without the upload id", async () => {
    const { client } = fakeServer({ offset: 10 });
    await expect(
      endpoints.uploadChunk(client, { form_data: new FormData(), offset: 0, chunk_size: 10 })
    ).rejects.toThrow("upload chunk");
  });

  it("completes an upload; a server before #2737 answers {}", async () => {
    const { client, requests } = fakeServer({});
    const form = new FormData();
    form.append("upload_id", "u1");
    await expect(endpoints.completeUpload(client, form)).resolves.toEqual({});
    expect(defined(requests[0])).toMatchObject({ url: `${API}/upload/complete/`, method: "POST", body: form });
  });

  it("reads the import job and photo a completed upload answers, or the duplicate's detail", async () => {
    const answer = { job_id: "5b0c4f4e-2a6c-4bb1-9f7e-0a1f3c2d4e5f", photo_id: "0f6c3c1e-5b8a-4d2e-9a51-6f0b8f1d2c3a" };
    await expect(endpoints.completeUpload(fakeServer(answer).client, new FormData())).resolves.toEqual(answer);
    const duplicate = { detail: "Photo duplicated. No new import performed.", photo_id: answer.photo_id };
    await expect(endpoints.completeUpload(fakeServer(duplicate).client, new FormData())).resolves.toEqual(duplicate);
  });

  it("seals the import jobs of an upload run", async () => {
    const { client, requests } = fakeServer({ sealed_job_ids: ["j1"] });
    await expect(endpoints.sealUploadImports(client, ["j1", "j2"])).resolves.toEqual({ sealed_job_ids: ["j1"] });
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/upload/seal/`,
      method: "POST",
      body: { job_ids: ["j1", "j2"] },
    });
  });

  it("asks for the upload status with repeated job and photo ids, and reads an import job's result", async () => {
    const status = {
      imports: [
        {
          id: 4,
          job_id: "j1",
          queued_at: "2026-10-22T10:00:00Z",
          started_at: "2026-10-22T10:00:00Z",
          finished_at: null,
          finished: false,
          failed: false,
          cancelled: false,
          job_type: 20,
          job_type_str: "Import Uploads",
          started_by: { id: 1, username: "admin", first_name: "", last_name: "" },
          progress_current: 1,
          progress_target: 3,
          progress_step: null,
          result: {
            stages: { media: 1 },
            failed_files: [{ photo_id: "p2", file: "a.NEF", stage: "media", error: "unsupported" }],
          },
          is_scan_baseline: false,
        },
      ],
      ready_photo_ids: ["p1"],
      followups: { state: "pending", next_run_at: "2026-10-22T10:02:00Z" },
    };
    const { client, requests } = fakeServer(status);
    const answer = await endpoints.fetchUploadStatus(client, { jobIds: ["j1"], photoIds: ["p1", "p2"] });
    expect(defined(requests[0]).url).toBe(`${API}/upload/status/?job_id=j1&photo_id=p1&photo_id=p2`);
    expect(defined(answer.imports[0]).result?.failed_files?.[0]?.stage).toBe("media");
    expect(answer.followups.state).toBe("pending");
  });

  it("asks for the upload status without ids", async () => {
    const empty = { imports: [], ready_photo_ids: [], followups: { state: "idle", next_run_at: null } };
    const { client, requests } = fakeServer(empty);
    await expect(endpoints.fetchUploadStatus(client)).resolves.toEqual(empty);
    expect(defined(requests[0]).url).toBe(`${API}/upload/status/`);
  });

  it("asks whether the user already has a file by its MD5 and user id, and answers its photo", async () => {
    const photoId = "0f6c3c1e-5b8a-4d2e-9a51-6f0b8f1d2c3a";
    const { client, requests } = fakeServer({ exists: true, photo_id: photoId });
    await expect(endpoints.uploadExists(client, "d41d8cd98f00b204e9800998ecf8427e", 7)).resolves.toEqual({
      exists: true,
      photo_id: photoId,
    });
    expect(defined(requests[0]).url).toBe(`${API}/exists/d41d8cd98f00b204e9800998ecf8427e7`);
  });

  it("reads an exists answer from a server before #612, which sends no photo id", async () => {
    const { client } = fakeServer({ exists: false });
    await expect(endpoints.uploadExists(client, "d41d8cd98f00b204e9800998ecf8427e", 7)).resolves.toEqual({
      exists: false,
    });
  });

  it("files photos into an album by id, without a title that would undo a rename", async () => {
    const { client, requests } = fakeServer({ id: 12, title: "Porto 2025" });
    await expect(endpoints.addPhotosToUserAlbumById(client, 12, ["p1"])).resolves.toMatchObject({ id: 12 });
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/albums/user/edit/12/`,
      method: "PATCH",
      body: { photos: ["p1"] },
    });
  });
});
