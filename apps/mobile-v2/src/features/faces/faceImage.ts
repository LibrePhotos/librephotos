import type { PersonFace } from "@librephotos/api-client";

/**
 * Build a fetchable URL for a face crop. The backend returns `face_url`
 * (preferred) or `face_photo_url` as a server-relative media path; prepend the
 * server origin. Absolute URLs are passed through unchanged.
 */
export function faceImageUrl(base: string, face: Pick<PersonFace, "face_url" | "image">): string | null {
  const path = face.face_url ?? face.image ?? null;
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}
