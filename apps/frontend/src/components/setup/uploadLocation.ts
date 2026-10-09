// The backend's per-device subfolder for uploads made through the web interface.
const WEB_DEVICE = "web";

function join(base: string, ...parts: string[]): string {
  const trimmed = base.replace(/[\\/]+$/, "");
  const separator = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return [trimmed, ...parts].join(separator);
}

/**
 * Folder that web uploads land in, as the backend computes it: the backend's
 * `User.upload_root()` (the configured upload folder, or the `uploads` folder
 * inside the scan directory) plus the per-device `web` subfolder.
 *
 * Returns `null` without a scan directory: the backend refuses uploads then,
 * even when an upload folder is set, so there is no location to show.
 */
export function uploadLocation(
  scanDirectory: string | null | undefined,
  uploadDirectory?: string | null
): string | null {
  if (!scanDirectory) {
    return null;
  }
  if (uploadDirectory) {
    return join(uploadDirectory, WEB_DEVICE);
  }
  return join(scanDirectory, "uploads", WEB_DEVICE);
}
