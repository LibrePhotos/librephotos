import { isHashMessage, md5OfBlob } from "./md5Hashing";

// < 1MB chunks, because of the nginx default client_max_body_size
const CHUNK_SIZE = 1000000;

/** How much of a file is read at a time to hash it: one slice is in memory at most. */
const HASH_SLICE_BYTES = 25 * 1024 * 1024;

/** Thrown when the user cancels the upload of the file being hashed or sent. */
export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelledError";
  }
}

/** The one failure an upload reports for a file that could not be read to its end. */
const readFailure = () => new DOMException("Problem parsing input file.");

/** The hashing worker, or null where there is none (tests, a browser without module workers). */
function startHashWorker(): Worker | null {
  if (typeof Worker !== "function") return null;
  try {
    return new Worker(new URL("./md5Worker.ts", import.meta.url), { type: "module", name: "md5" });
  } catch {
    return null;
  }
}

/** The same hash on the page's own thread, where no worker can run. */
async function md5InPage(file: Blob, isCancelled: () => boolean, sliceBytes: number): Promise<string> {
  try {
    const md5 = await md5OfBlob(file, sliceBytes, () => !isCancelled());
    if (md5 === null) throw new UploadCancelledError();
    return md5;
  } catch (error) {
    throw error instanceof UploadCancelledError ? error : readFailure();
  }
}

/**
 * MD5 of the whole file, as hex: the server compares it with the MD5 of the file it assembled from
 * the chunks. It is read in 25 MB slices in a worker, so hashing a large video never blocks the page.
 * `isCancelled` is asked between slices, so a cancelled upload stops hashing (and the worker, with
 * the slice it holds, goes) within one slice. A worker that cannot start (a Content-Security-Policy
 * without `worker-src 'self'`, say) leaves the hashing to the page.
 */
export function calculateMD5(
  file: Blob,
  isCancelled: () => boolean = () => false,
  sliceBytes: number = HASH_SLICE_BYTES
): Promise<string> {
  const worker = startHashWorker();
  if (worker === null) return md5InPage(file, isCancelled, sliceBytes);
  return new Promise<string>((resolve, reject) => {
    let answered = false;
    const finish = (settle: () => void) => {
      worker.terminate();
      settle();
    };
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isHashMessage(message)) return;
      answered = true;
      switch (message.type) {
        case "slice":
          if (isCancelled()) finish(() => reject(new UploadCancelledError()));
          return;
        case "done":
          finish(() => resolve(message.md5));
          return;
        case "failed":
          finish(() => reject(readFailure()));
          return;
      }
    });
    worker.addEventListener("error", event => {
      event.preventDefault();
      // The worker never ran (its script did not load): hash on the page instead.
      if (!answered) finish(() => resolve(md5InPage(file, isCancelled, sliceBytes)));
      else finish(() => reject(readFailure()));
    });
    worker.postMessage({ file, sliceBytes });
  });
}

export function calculateChunks(file: File, blockSize: number = CHUNK_SIZE): Blob[] {
  const count = Math.ceil(file.size / blockSize);
  return Array.from({ length: count }, (_unused, i) =>
    file.slice(i * blockSize, Math.min((i + 1) * blockSize, file.size))
  );
}
