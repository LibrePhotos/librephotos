/**
 * Decoded-image cache shared by the stage, the slideshow and the neighbour prefetch.
 *
 * `load(url)` fetches and fully decodes a picture off-screen (`img.decode()`), so swapping it into the
 * DOM afterwards paints in the same frame. Several callers can wait for the same URL; when every one
 * of them aborts before the picture arrives, the request is cancelled (`img.src = ""`).
 */
export type Dims = { w: number; h: number };

type Entry = {
  img: HTMLImageElement;
  promise: Promise<Dims>;
  dims: Dims | null;
  settled: boolean;
  waiters: number;
};

const MAX_ENTRIES = 48;
const entries = new Map<string, Entry>();

function touch(url: string, entry: Entry): void {
  entries.delete(url);
  entries.set(url, entry);
}

function trim(): void {
  if (entries.size <= MAX_ENTRIES) return;
  for (const [url, entry] of entries) {
    if (entries.size <= MAX_ENTRIES) break;
    if (entry.settled) entries.delete(url);
  }
}

function start(url: string): Entry {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  const entry: Entry = { img, promise: Promise.resolve({ w: 0, h: 0 }), dims: null, settled: false, waiters: 0 };
  entry.promise = img.decode().then(
    () => {
      const dims = { w: img.naturalWidth, h: img.naturalHeight };
      entry.dims = dims;
      entry.settled = true;
      trim();
      return dims;
    },
    (err: unknown) => {
      entry.settled = true;
      if (entries.get(url) === entry) entries.delete(url);
      throw err instanceof Error ? err : new Error(String(err));
    },
  );
  entries.set(url, entry);
  return entry;
}

/** Size of an already decoded picture, or null. */
export function peek(url: string): Dims | null {
  const entry = entries.get(url);
  if (!entry?.dims) return null;
  touch(url, entry);
  return entry.dims;
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Loads and decodes `url`. Rejects with an AbortError when `signal` fires first. */
export function load(url: string, signal?: AbortSignal): Promise<Dims> {
  const known = peek(url);
  if (known) return Promise.resolve(known);
  if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
  const entry = entries.get(url) ?? start(url);
  entry.waiters += 1;
  return new Promise<Dims>((resolve, reject) => {
    let done = false;
    const onAbort = () => {
      if (done) return;
      done = true;
      reject(new DOMException("aborted", "AbortError"));
      entry.waiters -= 1;
      if (entry.waiters <= 0 && !entry.settled) {
        entry.img.src = "";
        if (entries.get(url) === entry) entries.delete(url);
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      dims => {
        if (done) return;
        done = true;
        entry.waiters -= 1;
        signal?.removeEventListener("abort", onAbort);
        resolve(dims);
      },
      (err: unknown) => {
        if (done) return;
        done = true;
        entry.waiters -= 1;
        signal?.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
