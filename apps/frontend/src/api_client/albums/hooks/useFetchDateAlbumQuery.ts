import { useQuery } from '@tanstack/react-query';
import { IncompleteDatePhotosGroup, Photoset } from "../../photos/types";
import { fetchClient, queryClient } from "../../api";
import { FetchDateAlbumResponse } from "../types";
import { DateAlbumsQueryKeys } from './useFetchDateAlbumsQuery';

type AlbumDateOption = {
  photosetType: Photoset;
  album_date_id: string;
  page: number;
  username?: string;
  person_id?: number;
  folder?: string;
};

export const DateAlbumQueryKeys = ["dateAlbum"]

// Fetch a single date album
export const useFetchDateAlbumQuery = (options: AlbumDateOption, queryOptions?: { skip?: boolean }) => useQuery({
    queryKey: [...DateAlbumQueryKeys, options.photosetType, options.album_date_id, options.page, options.person_id, options.username, options.folder],
    queryFn: async () => {
      const params = {
        favorite: Photoset.FAVORITES === options.photosetType ? "true" : undefined,
        public: Photoset.PUBLIC === options.photosetType ? "true" : undefined,
        hidden: Photoset.HIDDEN === options.photosetType ? "true" : undefined,
        in_trashcan: Photoset.IN_TRASHCAN === options.photosetType ? "true" : undefined,
        photo: Photoset.PHOTOS === options.photosetType ? "true" : undefined,
        video: Photoset.VIDEOS === options.photosetType ? "true" : undefined,
        page: options.page.toString(),
        person: options.person_id?.toString(),
        username: options.username?.toLowerCase(),
        folder: options.folder,
      };

      const response = await fetchClient.get(`/albums/date/${options.album_date_id}?${new URLSearchParams(
        Object.entries(params).filter(([_, v]) => v !== undefined) as [string, string][]
      ).toString()}`);
      
      const result = FetchDateAlbumResponse.parse(response).results;
      
      // Get the current data from cache
      const dateAlbumsQueryKey = [...DateAlbumsQueryKeys, options.photosetType, options.person_id, options.username, options.folder];
      const oldData = queryClient.getQueryData(dateAlbumsQueryKey) as IncompleteDatePhotosGroup[] | undefined;
      
      if (oldData) {
        const newData = [...oldData];
        const indexToReplace = newData.findIndex(group => group.id === options.album_date_id);
        
        if (indexToReplace !== -1) {
          const groupToChange = {...newData[indexToReplace]};
          const { items } = groupToChange;
          
          groupToChange.items = items
            .slice(0, (options.page - 1) * 100)
            .concat(result.items)
            .concat(items.slice(options.page * 100));
          
          newData[indexToReplace] = groupToChange;
          
          // Update the cache with the new data and trigger a notification
          queryClient.setQueryData(dateAlbumsQueryKey, newData);
        }
      }
      
      return result;
    },
    enabled: queryOptions?.skip === undefined ? true : !queryOptions.skip,
  }); 