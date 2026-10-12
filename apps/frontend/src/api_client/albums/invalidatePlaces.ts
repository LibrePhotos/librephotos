import { queryClient } from "../api";
import { photoGridKeys } from "../photos/keys";
import { albumKeys } from "./keys";

// A photo's new location re-geocodes it on the server and moves it between
// place albums at once; without this the Places page, its map and the albums
// overview kept showing the old place for the whole stale time.
export function invalidatePlaces() {
  [albumKeys.placesAlbums(), photoGridKeys.kind("placeAlbum"), albumKeys.locationClusters()].forEach(queryKey => {
    queryClient.invalidateQueries({ queryKey });
  });
}
