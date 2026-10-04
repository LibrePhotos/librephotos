/**
 * Folder that web uploads are written to, as the backend's `User.upload_root()`
 * computes it: the configured upload folder, or the `uploads` folder inside the
 * scan directory. The backend adds one subfolder per uploading device.
 */
export function uploadLocation(scanDirectory: string | null | undefined, uploadDirectory?: string | null): string {
  if (uploadDirectory) {
    return uploadDirectory;
  }
  const base = (scanDirectory ?? "").replace(/[\\/]+$/, "");
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${separator}uploads`;
}
