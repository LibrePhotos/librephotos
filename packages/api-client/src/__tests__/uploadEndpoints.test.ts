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

  it("completes an upload; the server answers {} whether or not the file was new", async () => {
    const { client, requests } = fakeServer({});
    const form = new FormData();
    form.append("upload_id", "u1");
    await expect(endpoints.completeUpload(client, form)).resolves.toEqual({});
    expect(defined(requests[0])).toMatchObject({ url: `${API}/upload/complete/`, method: "POST", body: form });
  });

  it("asks whether the user already has a file by its MD5 and user id", async () => {
    const { client, requests } = fakeServer({ exists: true });
    await expect(endpoints.uploadExists(client, "d41d8cd98f00b204e9800998ecf8427e", 7)).resolves.toBe(true);
    expect(defined(requests[0]).url).toBe(`${API}/exists/d41d8cd98f00b204e9800998ecf8427e7`);
  });
});
