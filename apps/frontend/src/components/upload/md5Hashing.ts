import { Md5 } from "./md5";

/** What the page asks the hashing worker: the file (passed by reference, not copied) and its slice size. */
export type HashRequest = Readonly<{ file: Blob; sliceBytes: number }>;

/** What the worker answers: a slice is done (the page may cancel now), the digest, or a failed read. */
export type HashMessage =
  Readonly<{ type: "slice" }> | Readonly<{ type: "done"; md5: string }> | Readonly<{ type: "failed" }>;

export function isHashRequest(data: unknown): data is HashRequest {
  return (
    typeof data === "object" &&
    data !== null &&
    "file" in data &&
    data.file instanceof Blob &&
    "sliceBytes" in data &&
    typeof data.sliceBytes === "number" &&
    data.sliceBytes > 0
  );
}

export function isHashMessage(data: unknown): data is HashMessage {
  if (typeof data !== "object" || data === null || !("type" in data)) return false;
  switch (data.type) {
    case "slice":
    case "failed":
      return true;
    case "done":
      return "md5" in data && typeof data.md5 === "string";
    default:
      return false;
  }
}

/** A read that came back short: the file changed (shrank) while it was hashed. */
class ShortReadError extends Error {
  constructor() {
    super("The file changed while it was read");
    this.name = "ShortReadError";
  }
}

/**
 * MD5 of `blob`, read in slices of `sliceBytes` with `Blob.arrayBuffer()`, so at most one slice is
 * in memory. After every slice but the last, `keepGoing` is asked; false stops the hash and resolves
 * null. A slice read short rejects with ShortReadError.
 */
export async function md5OfBlob(blob: Blob, sliceBytes: number, keepGoing: () => boolean): Promise<string | null> {
  const md5 = new Md5();
  let offset = 0;
  while (offset < blob.size) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + sliceBytes).arrayBuffer());
    if (bytes.length === 0) throw new ShortReadError();
    md5.update(bytes);
    offset += bytes.length;
    if (offset < blob.size && !keepGoing()) return null;
  }
  return md5.digest();
}

/** The worker's side: hashes the requested file and reports each slice, then the digest. */
export async function answerHashRequest(request: HashRequest, post: (message: HashMessage) => void): Promise<void> {
  try {
    const md5 = await md5OfBlob(request.file, request.sliceBytes, () => {
      post({ type: "slice" });
      return true;
    });
    post(md5 === null ? { type: "failed" } : { type: "done", md5 });
  } catch {
    post({ type: "failed" });
  }
}
