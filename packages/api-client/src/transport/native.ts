export type NativeFilePartRef = { marker: string; ref: unknown };

export type NativeRequest = {
  url: string;
  method: string;
  headers: [string, string][];
  body: Uint8Array<ArrayBuffer> | null;
  signal: AbortSignal;
  fileParts: NativeFilePartRef[];
};

export type NativeResponse = {
  status: number;
  statusText?: string;
  headers: [string, string][] | Record<string, string>;
  body: Uint8Array<ArrayBuffer> | null;
};

export type NativeSend = (request: NativeRequest) => Promise<NativeResponse>;

const placeholders = new WeakMap<File, NativeFilePartRef>();

function randomMarker(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `lp-native-part-${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;
}

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

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function abortReason(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason;
  return reason ?? new DOMException("The operation was aborted.", "AbortError");
}

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
