import { queryClient } from "../api";
import { LocationClustersQueryKeys } from "./hooks/useFetchLocationClustersQuery";
import { PlaceAlbumQueryKeys } from "./hooks/useFetchPlaceAlbumQuery";
import { PlacesAlbumsQueryKeys } from "./hooks/useFetchPlacesAlbumsQuery";

// A photo's new location re-geocodes it on the server and moves it between
// place albums at once; without this the Places page, its map and the albums
// overview kept showing the old place for the whole stale time.
export function invalidatePlaces() {
  [PlacesAlbumsQueryKeys, PlaceAlbumQueryKeys, LocationClustersQueryKeys].forEach(queryKey => {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  });
}
