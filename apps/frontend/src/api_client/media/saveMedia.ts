import { fetchMedia } from "./mediaUrl";

/**
 * Save a media file under a name of the app's choosing. A link's `download` name gives way to the
 * name in the server's Content-Disposition, so the file is fetched (with the session cookies) and
 * saved from a blob, which keeps the name. Rejects with the ApiError of a failed request.
 */
export async function saveMediaFile(url: string, fileName: string, init: RequestInit = {}): Promise<void> {
  const response = await fetchMedia(url, init);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
