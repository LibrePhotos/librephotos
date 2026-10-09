import { AutoAlbumQueryKeys } from "../albums/hooks/useFetchAutoAlbumQuery";
import { DateAlbumQueryKeys } from "../albums/hooks/useFetchDateAlbumQuery";
import { DateAlbumsQueryKeys } from "../albums/hooks/useFetchDateAlbumsQuery";
import { PlaceAlbumQueryKeys } from "../albums/hooks/useFetchPlaceAlbumQuery";
import { ThingsAlbumQueryKeys } from "../albums/hooks/useFetchThingsAlbumQuery";
import { UserAlbumQueryKeys } from "../albums/hooks/useFetchUserAlbumQuery";
import { queryClient } from "../api";
import { SearchPhotosQueryKeys } from "../search/hooks/useSearchPhotosQuery";
import { TagAlbumQueryKeys } from "../tags/hooks/useFetchTagAlbumQuery";
import { PhotosWithoutTimestampQueryKeys } from "./hooks/useFetchPhotosWithoutTimestampQuery";
import { RecentlyAddedPhotosQueryKeys } from "./hooks/useFetchRecentlyAddedPhotosQuery";

// Every query that feeds a photo grid. A change to a photo's favourite,
// hidden or trash state (or its date) must refresh all of them: invalidating
// only the timeline left album, event, place, thing, tag, search and
// no-timestamp grids showing the old state until a reload.
const PHOTO_LIST_QUERY_KEYS: ReadonlyArray<readonly string[]> = [
  DateAlbumsQueryKeys,
  DateAlbumQueryKeys,
  RecentlyAddedPhotosQueryKeys,
  UserAlbumQueryKeys,
  AutoAlbumQueryKeys,
  PlaceAlbumQueryKeys,
  ThingsAlbumQueryKeys,
  TagAlbumQueryKeys,
  SearchPhotosQueryKeys,
  PhotosWithoutTimestampQueryKeys,
];

// Only the grids on screen refetch; the others are marked stale and refetch
// when the user opens them.
export function invalidatePhotoLists() {
  PHOTO_LIST_QUERY_KEYS.forEach(queryKey => {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  });
}
