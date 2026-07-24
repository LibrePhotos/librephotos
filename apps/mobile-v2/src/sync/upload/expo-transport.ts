/**
 * Real {@link UploadTransport} for the LibrePhotos chunked-upload endpoints
 * (apps/backend/api/views/upload.py). App-only: imported solely by sync/run.
 *
 * Auth nuance: `/api/exists/` uses the normal DRF JWT (Authorization: Bearer),
 * but `UploadPhotosChunked` / `...Complete` read the token from a `jwt` COOKIE
 * (they override check_permissions). We therefore send BOTH the bearer header
 * and a `Cookie: jwt=<token>` on the upload/complete calls.
 *
 * The bytes go through `expo-file-system` `uploadAsync` (streams from disk,
 * background URLSession on iOS). v1 sends the whole file as a single chunk
 * (offset 0, full Content-Range) — valid against the chunked endpoint; true
 * multi-chunk resume is a Phase 4 enhancement (see handoff).
 */
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import type {
  UploadCompleteInput,
  UploadFileInput,
  UploadProgress,
  UploadTransport,
} from "./transport";

export type TransportDeps = {
  /** Bare server origin, no trailing slash, no `/api`. */
  serverAddress: () => string;
  getAccessToken: () => Promise<string | null>;
};

function authHeaders(token: string | null, withCookie: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (token) {
    h.Authorization = `Bearer ${token}`;
    if (withCookie) h.Cookie = `jwt=${token}`;
  }
  return h;
}

async function resolveReadableUri(id: string, uri: string): Promise<string> {
  if (!uri.startsWith("ph://")) return uri;
  const info = await MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: true });
  if (!info.localUri) throw new Error("could not resolve ph:// asset to a local uri");
  return info.localUri;
}

export function createExpoUploadTransport(deps: TransportDeps): UploadTransport {
  const base = () => deps.serverAddress().replace(/\/+$/, "");

  return {
    async exists(hash: string): Promise<boolean> {
      const token = await deps.getAccessToken();
      const res = await fetch(`${base()}/api/exists/${encodeURIComponent(hash)}/`, {
        method: "GET",
        headers: { Accept: "application/json", ...authHeaders(token, false) },
      });
      if (!res.ok) throw new Error(`exists check failed: HTTP ${res.status}`);
      const json = (await res.json()) as { exists?: boolean };
      return json.exists === true;
    },

    async uploadFile(
      input: UploadFileInput,
      onProgress?: (p: UploadProgress) => void
    ): Promise<{ uploadId: string }> {
      const token = await deps.getAccessToken();
      const uri = await resolveReadableUri(input.assetId, input.uri);
      const stat = await FileSystem.getInfoAsync(uri);
      if (!stat.exists) throw new Error("asset file not found on disk");
      const size = stat.size ?? 0;

      const task = FileSystem.createUploadTask(
        `${base()}/api/upload/`,
        uri,
        {
          httpMethod: "POST",
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: "file",
          mimeType: input.type === "video" ? "video/mp4" : "application/octet-stream",
          parameters: { offset: "0", user: String(input.userId) },
          headers: {
            // Whole file as a single chunk: 0..size-1 / size.
            "Content-Range": `bytes 0-${Math.max(0, size - 1)}/${size}`,
            ...authHeaders(token, true),
          },
        },
        (data) => {
          onProgress?.({ sent: data.totalBytesSent, total: data.totalBytesExpectedToSend });
        }
      );
      const result = await task.uploadAsync();
      if (!result || result.status >= 300) {
        throw new Error(`upload failed: HTTP ${result?.status ?? "?"}`);
      }
      let uploadId = "";
      try {
        const parsed = JSON.parse(result.body) as { upload_id?: string };
        uploadId = parsed.upload_id ?? "";
      } catch {
        throw new Error("upload response was not valid JSON");
      }
      if (!uploadId) throw new Error("upload response missing upload_id");
      return { uploadId };
    },

    async complete(input: UploadCompleteInput): Promise<void> {
      const token = await deps.getAccessToken();
      const form = new FormData();
      form.append("upload_id", input.uploadId);
      form.append("md5", input.md5);
      form.append("user", String(input.userId));
      form.append("filename", input.filename);
      if (input.deviceCreatedAt != null) form.append("device_created_at", String(input.deviceCreatedAt));
      if (input.deviceModifiedAt != null) form.append("device_modified_at", String(input.deviceModifiedAt));
      const res = await fetch(`${base()}/api/upload/complete/`, {
        method: "POST",
        headers: { ...authHeaders(token, true) },
        body: form,
      });
      if (!res.ok) throw new Error(`complete failed: HTTP ${res.status}`);
    },
  };
}
