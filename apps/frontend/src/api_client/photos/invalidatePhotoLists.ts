import { photoGridKeys } from "@librephotos/api-client";
import type { QueryClient } from "@tanstack/react-query";

// Every query that feeds a photo grid sits under photoGridKeys.all. A change
// to a photo's favourite, hidden or trash state (or its date, or its stack)
// must refresh all of them: invalidating only the timeline left album, event,
// place, thing, tag, search, no-timestamp and shared grids showing the old
// state until a reload.
//
// Only the grids on screen refetch; the others are marked stale and refetch
// when the user opens them.
export function invalidatePhotoLists(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: photoGridKeys.all });
}
