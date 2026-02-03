import { useQuery } from "@tanstack/react-query";
import { addTempElementsToGroups } from "../../../util/util";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { Photoset } from "../../photos/types";
import { FetchDateAlbumsListResponse } from "../types";

export const DateAlbumsQueryKeys = ["dateAlbums"] as const;

// Define the parameter types for the queries
type AlbumDateListOptions = {
  photosetType: Photoset;
  person_id?: number;
  username?: string;
  folder?: string;
};

// Fetch date albums
export const useFetchDateAlbumsQuery = (options: AlbumDateListOptions) =>
  useQuery({
    queryKey: [...DateAlbumsQueryKeys, options.photosetType, options.person_id, options.username, options.folder],
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
        folder: options.folder,
      };

      const response = await fetchClient.get(
        `/albums/date/list/?${new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
        ).toString()}`
      );

      const parsed = parseWithNotification(FetchDateAlbumsListResponse, response, "Failed to load photo groups");
      const { results } = parsed;

      addTempElementsToGroups(results);
      return results;
    },
  });
