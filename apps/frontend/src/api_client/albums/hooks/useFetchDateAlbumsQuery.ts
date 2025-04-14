import { useQuery } from '@tanstack/react-query';
import { Photoset } from "../../photos/types";
import { addTempElementsToGroups } from "../../../util/util";
import { fetchClient,  QueryKeys } from "../../api";
import { FetchDateAlbumsListResponse } from "../types";

// Define the parameter types for the queries
type AlbumDateListOptions = {
  photosetType: Photoset;
  person_id?: number;
  username?: string;
};

// Fetch date albums
export const useFetchDateAlbumsQuery = (options: AlbumDateListOptions) => {
  return useQuery({
    queryKey: [QueryKeys.dateAlbums, options.photosetType, options.person_id, options.username],
    queryFn: async () => {
      const params = {
        favorite: Photoset.FAVORITES === options.photosetType ? "true" : undefined,
        public: Photoset.PUBLIC === options.photosetType ? "true" : undefined,
        hidden: Photoset.HIDDEN === options.photosetType ? "true" : undefined,
        in_trashcan: Photoset.IN_TRASHCAN === options.photosetType ? "true" : undefined,
        photo: Photoset.PHOTOS === options.photosetType ? "true" : undefined,
        video: Photoset.VIDEOS === options.photosetType ? "true" : undefined,
        person: options.person_id,
        username: options.username?.toLowerCase(),
      };

      const response = await fetchClient.get(`/albums/date/list/?${new URLSearchParams(
        Object.entries(params).filter(([_, v]) => v !== undefined) as [string, string][]
      ).toString()}`);
      
      const { results } = FetchDateAlbumsListResponse.parse(response);
      addTempElementsToGroups(results);
      return results;
    },
  });
};
