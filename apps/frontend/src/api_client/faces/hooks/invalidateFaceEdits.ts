import { albumKeys, faceKeys, invalidateAfter, photoKeys, statsKeys } from "@librephotos/api-client";
import type { QueryClient } from "@tanstack/react-query";

/**
 * After faces were labelled, deleted or restored: the face lists, the people albums (face counts and
 * labels change), the statistics (num_faces, num_people) and the photo details (their people), after
 * a short delay so the backend has finished.
 */
export function invalidateFaceEdits(queryClient: QueryClient): void {
  invalidateAfter(queryClient, [
    faceKeys.incomplete(),
    faceKeys.personFaces(),
    albumKeys.peopleAlbums(),
    statsKeys.counts(),
    photoKeys.details(),
  ]);
}
