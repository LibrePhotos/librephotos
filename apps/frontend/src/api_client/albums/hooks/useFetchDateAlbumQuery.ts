import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type { IncompleteDatePhotosGroup, MediaType, Photoset } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { type TimelineFilter } from "../../../components/photolist/timelineFilter";
import { apiClient, queryClient } from "../../api";
import { usePhotoOrder } from "../../user/hooks/usePhotoOrder";
import { dateAlbumRequestFilter, dateAlbumsListKey } from "./useFetchDateAlbumsQuery";

type AlbumDateOption = {
  photosetType: Photoset;
  album_date_id: number;
  page: number;
  username?: string;
  person_id?: number;
  folder?: string;
  mediaType?: MediaType;
  timelineFilter?: TimelineFilter;
  library?: number;
  withLibraries?: boolean;
};

// One page of a day, in the same photo order (#2712) as the day list it fills in.
export const useFetchDateAlbumQuery = (dayOptions: AlbumDateOption, queryOptions?: { skip?: boolean }) => {
  const photoOrder = usePhotoOrder();
  const options = { ...dayOptions, order: photoOrder.order };
  return useQuery({
    queryKey: photoGridKeys.dateAlbumDay(dateAlbumsListKey(options), options.album_date_id, options.page),
    queryFn: async () => {
      const filter = dateAlbumRequestFilter(options);
      const result = await endpoints.fetchDateAlbum(apiClient, options.album_date_id, options.page, filter);

      // Get the current data from cache
      const dateAlbumsQueryKey = photoGridKeys.dateAlbumList(dateAlbumsListKey(options));
      const oldData = queryClient.getQueryData<IncompleteDatePhotosGroup[]>(dateAlbumsQueryKey);

      if (oldData) {
        const newData = [...oldData];
        const indexToReplace = newData.findIndex(group => group.id === options.album_date_id);

        const existingGroup = newData[indexToReplace];

        if (indexToReplace !== -1 && existingGroup !== undefined) {
          const groupToChange = { ...existingGroup };
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
    enabled: !queryOptions?.skip && photoOrder.ready,
  });
};
