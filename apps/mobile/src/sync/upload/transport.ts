/**
 * Upload transport contract (doc 03 §5, §4-backend). Abstracts the three
 * backend calls the worker makes, so the worker state machine is Node-tested
 * against a fake transport. The real fetch/expo-file-system implementation lives
 * in ./expo-transport (app-only).
 *
 * Backend contract (apps/backend/api/views/upload.py):
 *   - GET  /api/exists/{hash}      → { exists: boolean }
 *   - POST /api/upload/            → chunked bytes; { upload_id, offset }
 *   - POST /api/upload/complete/   → finalize; optional device_created_at /
 *                                    device_modified_at (epoch ms) date fallback;
 *                                    { job_id, photo_id } (a duplicate:
 *                                    { detail, photo_id })
 */
import { isRecord, parseJson } from "@/lib/guards";

export type UploadFileInput = {
  assetId: string;
  /** Readable local uri (ph:// already resolved by the caller when needed). */
  uri: string;
  filename: string;
  /** 'image' | 'video' — selects the multipart mime type. */
  type: string | null;
  /** LibrePhotos hash (md5 + userId) — used only for the exists check. */
  hash: string;
  userId: number;
  /**
   * Raw md5 of these exact bytes, when the caller has already measured it (the
   * iCloud path checksums the original as it comes down). Lets the transport
   * skip a second full read of the same file; absent, it measures its own.
   */
  md5?: string;
};

export type UploadCompleteInput = {
  uploadId: string;
  filename: string;
  /** Raw md5 hex (NO userId suffix) — the chunked-upload checksum field. */
  md5: string;
  userId: number;
  /** Device capture time (ms epoch) — EXIF-less date fallback (issue #614). */
  deviceCreatedAt: number | null;
  deviceModifiedAt: number | null;
};

export type UploadProgress = { sent: number; total: number };

/**
 * What a chunk upload yields. `md5` is the checksum of the bytes that were
 * *actually sent* — see {@link UploadResult.md5}.
 */
export type UploadResult = {
  uploadId: string;
  /**
   * md5 of the uploaded bytes, when the transport could measure them.
   *
   * The completion call must checksum what it uploaded, not what was hashed
   * days earlier: `local_asset.hash` is recorded during the hash pass, and an
   * asset whose bytes changed in between (an iOS edit re-rendering the asset, a
   * re-download from iCloud) makes the server answer a permanent 400 "md5
   * checksum does not match" that no retry can clear. Falls back to the stored
   * hash when the transport has no better answer.
   */
  md5?: string;
};

/** What the completion call yields. */
export type UploadCompleteResult = {
  /**
   * The server photo the upload made (or the one it duplicates), null when the
   * server named none. Lets the Backup screen follow the photo until the mirror
   * has it with a thumbnail (#2740).
   */
  photoId: string | null;
};

/** Read `photo_id` from a `/api/upload/complete/` body; null for anything else. */
export function parseCompleteResponse(body: string): UploadCompleteResult {
  let parsed: unknown = null;
  try {
    parsed = parseJson(body);
  } catch {
    // An empty or non-JSON body still means the upload completed.
  }
  const photoId = isRecord(parsed) ? parsed.photo_id : null;
  return { photoId: typeof photoId === "string" && photoId ? photoId : null };
}

export interface UploadTransport {
  /** GET /api/exists/{hash} */
  exists(hash: string): Promise<boolean>;
  /** POST /api/upload/ (one or more chunks). Resolves with the upload_id. */
  uploadFile(input: UploadFileInput, onProgress?: (p: UploadProgress) => void): Promise<UploadResult>;
  /** POST /api/upload/complete/ with device-timestamp fallback. */
  complete(input: UploadCompleteInput): Promise<UploadCompleteResult>;
}

/**
 * Split a LibrePhotos hash (`md5hex` + `str(userId)`) back into its raw md5 hex
 * for the chunked-upload checksum field. Falls back to stripping the numeric
 * userId suffix when present.
 */
export function rawMd5(hash: string, userId: number): string {
  const suffix = String(userId);
  if (hash.endsWith(suffix) && hash.length > suffix.length) {
    return hash.slice(0, hash.length - suffix.length);
  }
  return hash;
}
