/**
 * The api-client's native transport on the desktop: `createNativeFetch` from
 * `@librephotos/api-client/core`, sending through Rust (`http_fetch`, CONTRACT.md "Server"). One
 * binary IPC message each way, so nothing is turned into JSON:
 *
 *   u32 LE n | n bytes of JSON head | body bytes
 *
 * An upload chunk does not cross IPC at all: the backup engine puts a `nativeFilePart` naming the
 * file range in the form, and Rust reads those bytes into the body itself.
 */
import { createNativeFetch, type NativeRequest, type NativeResponse } from "@librephotos/api-client/core";
import { invoke } from "@tauri-apps/api/core";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let nextId = 0;

/** `head` as JSON and `body` in one buffer, for one raw IPC message. */
export function frame(head: unknown, body: Uint8Array | null): Uint8Array<ArrayBuffer> {
  const json = encoder.encode(JSON.stringify(head));
  const out = new Uint8Array(4 + json.length + (body?.length ?? 0));
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  if (body) out.set(body, 4 + json.length);
  return out;
}

/** The JSON head and the body of a framed message. */
export function unframe(raw: ArrayBuffer): { head: unknown; body: Uint8Array<ArrayBuffer> } {
  const n = new DataView(raw).getUint32(0, true);
  const head: unknown = JSON.parse(decoder.decode(new Uint8Array(raw, 4, n)));
  return { head, body: new Uint8Array(raw, 4 + n) };
}

type Head = { status: number; statusText: string; headers: [string, string][] };

function isHead(v: unknown): v is Head {
  return typeof v === "object" && v !== null && "status" in v && typeof v.status === "number" && "headers" in v && Array.isArray(v.headers);
}

async function sendThroughRust(request: NativeRequest): Promise<NativeResponse> {
  const id = `r${++nextId}`;
  const onAbort = () => void invoke("http_fetch_abort", { id }).catch(() => undefined);
  request.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const head = { id, url: request.url, method: request.method, headers: request.headers, fileParts: request.fileParts };
    const raw = await invoke<ArrayBuffer>("http_fetch", frame(head, request.body)).catch((err: unknown) => {
      // `fetch` rejects a request without an answer with a TypeError.
      throw new TypeError(typeof err === "string" ? err : String(err));
    });
    const { head: answer, body } = unframe(raw);
    if (!isHead(answer)) throw new TypeError("http_fetch answered without a status");
    return { status: answer.status, statusText: answer.statusText, headers: answer.headers, body };
  } finally {
    request.signal.removeEventListener("abort", onAbort);
  }
}

/** The `fetch` every api-client request of the desktop goes through. */
export const nativeFetch: typeof fetch = createNativeFetch(sendThroughRust);
