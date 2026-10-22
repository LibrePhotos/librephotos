import type { NormalizedFaceBox } from "@librephotos/api-client";

/** A face drawn by hand, as `useAddFaceMutation` sends it. */
export type AddFaceRequest = { photo: string; personName: string; box: NormalizedFaceBox; fit?: boolean };

/**
 * What became of the last box drawn on a photo (#1117): the server is looking for the face in it,
 * or found none there. Kept per photo (`image_hash`, as the drawing sends it) so the photo's People
 * section can say so, in the lightbox and on the photo page alike; nothing while there is nothing
 * to say.
 */
export type DrawnFaceResult = Readonly<{ state: "finding" | "notfound"; request: AddFaceRequest }>;

const results = new Map<string, DrawnFaceResult>();
const listeners = new Set<() => void>();

export const drawnFaceResults = {
  set(result: DrawnFaceResult): void {
    results.set(result.request.photo, result);
    listeners.forEach(listener => listener());
  },
  clear(photo: string): void {
    if (results.delete(photo)) listeners.forEach(listener => listener());
  },
  get(photo: string): DrawnFaceResult | undefined {
    return results.get(photo);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
