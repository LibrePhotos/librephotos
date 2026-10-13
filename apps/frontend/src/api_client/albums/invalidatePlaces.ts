import { albumKeys, photoGridKeys } from "@librephotos/api-client";
import { queryClient } from "../api";

// A photo's new location re-geocodes it on the server and moves it between
// place albums at once; without this the Places page, its map and the albums
// overview kept showing the old place for the whole stale time. A set or
// removed location also moves the photo out of or into "Without Location".
export function invalidatePlaces() {
  [
    albumKeys.placesAlbums(),
    photoGridKeys.kind("placeAlbum"),
    albumKeys.locationClusters(),
    photoGridKeys.kind("withoutLocation"),
  ].forEach(queryKey => {
    queryClient.invalidateQueries({ queryKey });
  });
}
