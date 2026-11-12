import { fetchMedia } from "./mediaUrl";

/** The file extensions each media type is saved under; the first is the one a name gets. */
const EXTENSIONS: Partial<Record<string, readonly string[]>> = {
  "image/jpeg": ["jpg", "jpeg", "jpe", "jfif"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/avif": ["avif"],
  "image/heic": ["heic", "heif"],
  "image/heif": ["heif", "heic"],
  "image/tiff": ["tif", "tiff"],
  "video/mp4": ["mp4", "m4v"],
  "video/quicktime": ["mov", "qt"],
  "application/zip": ["zip"],
  "application/x-zip-compressed": ["zip"],
};

/**
 * The name a file of `contentType` is saved under: `fileName` when its extension fits the bytes,
 * else with the extension the bytes have (an edited photo's JPEG asked for under a RAW's name, a
 * download named by a hash). A type this table does not know keeps the name as it is.
 */
export function savedFileName(fileName: string, contentType: string | null): string {
  const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const extensions = EXTENSIONS[type];
  const wanted = extensions?.[0];
  if (!extensions || !wanted) return fileName;
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot + 1) : "";
  if (extensions.includes(extension.toLowerCase())) return fileName;
  // A short run of letters and digits after the last dot is an extension to replace.
  const stem = /^[a-z0-9]{1,5}$/i.test(extension) ? fileName.slice(0, dot) : fileName;
  // Joined, not a template: `${a}.${b}` would read as a pattern naming every translation key.
  return [stem, wanted].join(".");
}

/**
 * Save a media file under a name of the app's choosing. A link's `download` name gives way to the
 * name in the server's Content-Disposition, so the file is fetched (with the session cookies) and
 * saved from a blob, which keeps the name. Its extension follows the bytes the server answered
 * (`savedFileName`). Rejects with the ApiError of a failed request.
 */
export async function saveMediaFile(url: string, fileName: string, init: RequestInit = {}): Promise<void> {
  const response = await fetchMedia(url, init);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = savedFileName(fileName, response.headers.get("Content-Type"));
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
