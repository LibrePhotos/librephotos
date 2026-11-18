/**
 * Native transports (transport/native.ts): the client's requests sent through a host HTTP stack
 * that is not `fetch` (the desktop app's Rust side). The fake native stack here only sees plain
 * data (URL, method, header pairs, body bytes), as a Rust command would, and answers the same way.
 */
import { describe, expect, it, vi } from "vitest";
import * as endpoints from "../endpoints";
import { ApiError, createApiClient, createNativeFetch } from "../transport";
import type { NativeRequest, NativeResponse, NativeSend } from "../transport";
import { ResponseParseError } from "../util/parse";
import { defined } from "./defined";

const FUTURE_JWT =
  "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ exp: 9999999999, user_id: 1 })).toString("base64url") + ".sig";

const encoder = new TextEncoder();

function json(body: unknown, status = 200): NativeResponse {
  return { status, headers: [["content-type", "application/json"]], body: encoder.encode(JSON.stringify(body)) };
}

/** A native stack that records every request and answers with `answer`. */
function nativeStack(answer: (request: NativeRequest) => NativeResponse | Promise<NativeResponse>) {
  const sent: NativeRequest[] = [];
  const send = vi.fn<NativeSend>(async request => {
    sent.push(request);
    return answer(request);
  });
  const client = createApiClient({
    baseUrl: "https://photos.example.com",
    tokens: {
      getAccessToken: () => FUTURE_JWT,
      getRefreshToken: () => "r",
      setAccessToken: () => {},
      clearTokens: () => {},
    },
    fetch: createNativeFetch(send),
  });
  return { client, sent, send };
}

function header(request: NativeRequest, name: string): string | undefined {
  return request.headers.find(([key]) => key === name)?.[1];
}

/** The multipart body a native stack got, read back into a FormData. */
async function formOf(request: NativeRequest): Promise<FormData> {
  return new Response(request.body, {
    headers: { "content-type": defined(header(request, "content-type")) },
  }).formData();
}

describe("createNativeFetch", () => {
  it("sends JSON requests as bytes with the auth header and parses the answer with the endpoint schema", async () => {
    const { client, sent } = nativeStack(() => json({ exists: true, photo_id: "p1" }));
    await expect(endpoints.uploadExists(client, "abc", 7)).resolves.toEqual({ exists: true, photo_id: "p1" });
    const request = defined(sent[0]);
    expect(request.url).toBe("https://photos.example.com/api/exists/abc7");
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    expect(header(request, "authorization")).toBe(`Bearer ${FUTURE_JWT}`);
  });

  it("encodes object bodies as JSON", async () => {
    const { client, sent } = nativeStack(() => json({ sealed_job_ids: ["j1"] }));
    await endpoints.sealUploadImports(client, ["j1"]);
    const request = defined(sent[0]);
    expect(request.method).toBe("POST");
    expect(header(request, "content-type")).toBe("application/json");
    expect(JSON.parse(new TextDecoder().decode(defined(request.body)))).toEqual({ job_ids: ["j1"] });
  });

  it("encodes a FormData chunk as multipart, binary bytes intact, with the boundary in Content-Type", async () => {
    const { client, sent } = nativeStack(() => json({ upload_id: "u1", offset: 256 }));
    const bytes = new Uint8Array(256).map((_, i) => i);
    const form = new FormData();
    form.append("file", new Blob([bytes]), "IMG_1.jpg");
    form.append("offset", "0");
    form.append("md5", "m");

    await expect(endpoints.uploadChunk(client, { form_data: form, offset: 0, chunk_size: 256 })).resolves.toEqual({
      upload_id: "u1",
      offset: 256,
    });
    const request = defined(sent[0]);
    expect(header(request, "content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(header(request, "content-range")).toBe("bytes 0-255/256");
    const received = await formOf(request);
    const file = received.get("file");
    if (!(file instanceof Blob)) throw new Error("the chunk is not a file part");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(received.get("md5")).toBe("m");
  });

  it("passes raw bytes through untouched, with the caller's Content-Type", async () => {
    const { client, sent } = nativeStack(() => json({}));
    const bytes = new Uint8Array([0, 255, 1, 254]);
    await client.request<unknown>("/raw/", {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": "application/octet-stream" },
    });
    const request = defined(sent[0]);
    expect(header(request, "content-type")).toBe("application/octet-stream");
    expect(defined(request.body)).toEqual(bytes);
  });

  it("answers binary responses as a Blob", async () => {
    const bytes = new Uint8Array([1, 2, 3, 0, 255]);
    const { client } = nativeStack(() => ({ status: 200, headers: { "content-type": "image/jpeg" }, body: bytes }));
    const blob = await client.getBlob("/photos/download/");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it("answers 204 without a body", async () => {
    const { client } = nativeStack(() => ({ status: 204, headers: [], body: new Uint8Array(0) }));
    await expect(client.post<unknown>("/thing/")).resolves.toBe("");
  });

  it("turns an HTTP error into an ApiError with the server's message", async () => {
    const { client } = nativeStack(() =>
      json({ errors: [{ field: "", message: "Offsets do not match", code: "bad" }] }, 400)
    );
    const error: unknown = await endpoints.uploadExists(client, "abc", 7).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, serverMessage: "Offsets do not match" });
  });

  it("surfaces an answer that breaks the schema as a ResponseParseError naming the endpoint", async () => {
    const { client } = nativeStack(() => json({ exists: "yes" }));
    const error: unknown = await endpoints.uploadExists(client, "abc", 7).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResponseParseError);
    expect(error).toMatchObject({ context: "upload exists" });
  });

  it("rejects like fetch when the native stack has no answer", async () => {
    const { client } = nativeStack(() => Promise.reject(new TypeError("couldn't reach photos.example.com")));
    await expect(endpoints.uploadExists(client, "abc", 7)).rejects.toThrow(TypeError);
  });

  it("rejects with an AbortError at once and aborts the native side's signal", async () => {
    let release: (r: NativeResponse) => void = () => {};
    const { client, sent } = nativeStack(() => new Promise<NativeResponse>(resolve => (release = resolve)));
    const controller = new AbortController();
    const pending = client.request<unknown>("/slow/", { method: "GET", signal: controller.signal });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(defined(sent[0]).signal.aborted).toBe(true);
    release(json({}));
  });

  it("does not send a request whose signal is already aborted", async () => {
    const { client, send } = nativeStack(() => json({}));
    const controller = new AbortController();
    controller.abort();
    await expect(client.request<unknown>("/x/", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("refreshes on a 401 and retries through the same native stack", async () => {
    let calls = 0;
    const setAccessToken = vi.fn<(token: string) => void>();
    const send = vi.fn<NativeSend>(async request => {
      if (request.url.endsWith("/auth/token/refresh/")) return json({ access: "new-access" });
      calls += 1;
      return calls === 1 ? json({ detail: "expired" }, 401) : json({ exists: false });
    });
    const client = createApiClient({
      baseUrl: "https://photos.example.com",
      tokens: { getAccessToken: () => FUTURE_JWT, getRefreshToken: () => "r", setAccessToken, clearTokens: () => {} },
      fetch: createNativeFetch(send),
    });
    await expect(endpoints.uploadExists(client, "abc", 7)).resolves.toEqual({ exists: false });
    expect(setAccessToken).toHaveBeenCalledWith("new-access");
    const retried = defined(send.mock.calls[2]?.[0]);
    expect(header(retried, "authorization")).toBe("Bearer new-access");
  });
});
