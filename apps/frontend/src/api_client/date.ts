import { useQuery } from '@tanstack/react-query';
import { FetchDateAlbumResponseSchema, FetchDateAlbumsListResponseSchema } from "../actions/albumActions.types";
import { IncompleteDatePhotosGroup } from "../actions/photosActions.types";
import { PhotosetType } from "../reducers/photosReducer";
import { addTempElementsToGroups } from "../util/util";
import { fetchClient, queryClient, QueryKeys } from "./api";

// Define the QueryKeys for date albums
export enum DateAlbumQueryKeys {
  dateAlbums = 'dateAlbums',
  dateAlbum = 'dateAlbum',
}

// Define the parameter types for the queries
type AlbumDateListOptions = {
  photosetType: PhotosetType;
  person_id?: number;
  username?: string;
};

type AlbumDateOption = {
  photosetType: PhotosetType;
  album_date_id: string;
  page: number;
  username?: string;
  person_id?: number;
};

// Fetch date albums
export const useFetchDateAlbumsQuery = (options: AlbumDateListOptions) => {
  return useQuery({
    queryKey: [QueryKeys.dateAlbums, options.photosetType, options.person_id, options.username],
    queryFn: async () => {
      const params = {
        favorite: PhotosetType.FAVORITES === options.photosetType ? "true" : undefined,
        public: PhotosetType.PUBLIC === options.photosetType ? "true" : undefined,
        hidden: PhotosetType.HIDDEN === options.photosetType ? "true" : undefined,
        in_trashcan: PhotosetType.IN_TRASHCAN === options.photosetType ? "true" : undefined,
        photo: PhotosetType.PHOTOS === options.photosetType ? "true" : undefined,
        video: PhotosetType.VIDEOS === options.photosetType ? "true" : undefined,
        person: options.person_id,
        username: options.username?.toLowerCase(),
      };

      const response = await fetchClient.get(`/albums/date/list/?${new URLSearchParams(
        Object.entries(params).filter(([_, v]) => v !== undefined) as [string, string][]
      ).toString()}`);
      
      const { results } = FetchDateAlbumsListResponseSchema.parse(response);
      addTempElementsToGroups(results);
      return results;
    },
  });
};

// Fetch a single date album
export const useFetchDateAlbumQuery = (options: AlbumDateOption, queryOptions?: { skip?: boolean }) => {
  return useQuery({
    queryKey: [QueryKeys.dateAlbum, options.photosetType, options.album_date_id, options.page, options.person_id, options.username],
    queryFn: async () => {
      const params = {
        favorite: PhotosetType.FAVORITES === options.photosetType ? "true" : undefined,
        public: PhotosetType.PUBLIC === options.photosetType ? "true" : undefined,
        hidden: PhotosetType.HIDDEN === options.photosetType ? "true" : undefined,
        in_trashcan: PhotosetType.IN_TRASHCAN === options.photosetType ? "true" : undefined,
        photo: PhotosetType.PHOTOS === options.photosetType ? "true" : undefined,
        video: PhotosetType.VIDEOS === options.photosetType ? "true" : undefined,
        page: options.page.toString(),
        person: options.person_id?.toString(),
        username: options.username?.toLowerCase(),
      };

      const response = await fetchClient.get(`/albums/date/${options.album_date_id}?${new URLSearchParams(
        Object.entries(params).filter(([_, v]) => v !== undefined) as [string, string][]
      ).toString()}`);
      
      const result = FetchDateAlbumResponseSchema.parse(response).results;
      
      // Get the current data from cache
      const dateAlbumsQueryKey = [QueryKeys.dateAlbums, options.photosetType, options.person_id, options.username];
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
}; 