/**
 * Native transports: send the client's requests through an HTTP stack of the host instead of the
 * runtime's `fetch` (the desktop app's Rust side, a test double), so CORS, the webview's cookie jar
 * and its request limits never apply. Pass the result as `ApiClientConfig.fetch`:
 *
 *   createApiClient({ baseUrl, tokens, fetch: createNativeFetch(sendThroughRust) })
 *
 * The adapter encodes the request the way `fetch` would (a FormData body becomes multipart with its
 * boundary in Content-Type, an object body was already JSON-encoded by the client) and hands the
 * native side plain data: URL, method, header pairs and the body's bytes. The native side answers
 * with status, headers and bytes, and the adapter turns that into a `Response`, so everything above
 * it (refresh, ApiError, the endpoint schemas) runs exactly as it does on the web and on mobile.
 *
 * A file part whose bytes the native side has anyway (a chunk of a file on disk) need not pass
 * through JavaScript: put `nativeFilePart(ref, name)` in the FormData instead of the bytes. The
 * adapter sends a short marker in its place and lists it in `NativeRequest.fileParts`; the native
 * side replaces the marker with the bytes `ref` names before sending. Only for a `fetch` made by
 * `createNativeFetch`: any other fetch would send the marker itself.
 *
 * React-free and RN-free, like the rest of transport/.
 */

/** A file part the native side fills in: replace `marker` in the body with the bytes of `ref`. */
export type NativeFilePartRef = { marker: string; ref: unknown };

/** One request as a native HTTP stack sends it: the body already encoded. */
export type NativeRequest = {
  url: string;
  /** Upper case, as `Request` normalises it. */
  method: string;
  /** Header pairs, names lower case; a multipart body's Content-Type (with its boundary) included. */
  headers: [string, string][];
  /** The encoded body, null for none. */
  body: Uint8Array<ArrayBuffer> | null;
  /** Aborted when the caller aborts: a native stack cancels the request with it. */
  signal: AbortSignal;
  /** The body's `nativeFilePart`s, each to be replaced by its bytes; empty for most requests. */
  fileParts: NativeFilePartRef[];
};

/** What the native stack answers: any HTTP status counts as an answer. */
export type NativeResponse = {
  status: number;
  statusText?: string;
  headers: [string, string][] | Record<string, string>;
  /** The body's bytes; null or empty for none. */
  body: Uint8Array<ArrayBuffer> | null;
};

/**
 * Sends one request. Resolves with the server's answer whatever its status; rejects only when there
 * is no answer (network failure, abort), preferably with a `TypeError` like `fetch` does.
 */
export type NativeSend = (request: NativeRequest) => Promise<NativeResponse>;

const placeholders = new WeakMap<File, NativeFilePartRef>();

function randomMarker(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `lp-native-part-${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A FormData file part whose bytes the native side supplies (`ref` says which, e.g. a file and a
 * byte range). Append it without a file name argument (`form.append("file", part)`), so FormData
 * keeps this very object.
 */
export function nativeFilePart(ref: unknown, name: string): File {
  const marker = randomMarker();
  const file = new File([marker], name, { type: "application/octet-stream" });
  placeholders.set(file, { marker, ref });
  return file;
}

function filePartsOf(body: unknown): NativeFilePartRef[] {
  if (typeof FormData === "undefined" || !(body instanceof FormData)) return [];
  const parts: NativeFilePartRef[] = [];
  body.forEach(value => {
    const part = typeof value === "string" ? undefined : placeholders.get(value);
    if (part) parts.push(part);
  });
  return parts;
}

/** Statuses whose Response must not have a body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function abortReason(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason;
  return reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/** `answer`, or a rejection with the abort reason as soon as `signal` aborts. */
function untilAborted<T>(answer: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    answer.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new TypeError(String(error)));
      }
    );
  });
}

/**
 * A `fetch` that sends every request through `send`. Aborting the caller's signal rejects at once
 * with the abort reason (an `AbortError`), whatever the native side does with its copy of the signal.
 */
export function createNativeFetch(send: NativeSend): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const fileParts = filePartsOf(init?.body);
    const { signal } = request;
    if (signal.aborted) throw abortReason(signal);
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : null;
    const headers: [string, string][] = [];
    request.headers.forEach((value, name) => headers.push([name, value]));

    const answer = await untilAborted(
      send({ url: request.url, method: request.method, headers, body, signal, fileParts }),
      signal
    );

    if (answer.status < 200 || answer.status > 599) {
      throw new TypeError(`native transport answered status ${answer.status} for ${request.url}`);
    }
    const empty = NULL_BODY_STATUSES.has(answer.status) || request.method === "HEAD" || !answer.body;
    return new Response(empty ? null : answer.body, {
      status: answer.status,
      statusText: answer.statusText ?? "",
      headers: answer.headers,
    });
  };
}
