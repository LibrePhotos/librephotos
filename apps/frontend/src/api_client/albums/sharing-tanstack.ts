import _ from "lodash";
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../tanstack-api";
import type { UserAlbumList } from "./types";
import { UserAlbumListResponseSchema } from "./types";

// Types
type ShareUserAlbumParams = {
  albumId: string;
  userId: string;
  share: boolean;
};

type UserAlbumsGroupedByUserId = {
  user_id: number;
  albums: UserAlbumList[];
};

// Fetch shared albums by me
export const useFetchSharedAlbumsByMeQuery = () => useQuery({
  queryKey: [QueryKeys.sharedAlbumsByMe],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/user/shared/fromme/');
    return UserAlbumListResponseSchema.parse(response).results;
  },
});

// Fetch shared albums with me
export const useFetchSharedAlbumsWithMeQuery = () => useQuery({
  queryKey: [QueryKeys.sharedAlbumsWithMe],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/user/shared/tome/');
    const result = UserAlbumListResponseSchema.parse(response).results;
    return _.toPairs(_.groupBy(result, "owner.id")).map(el => ({
      user_id: parseInt(el[0], 10),
      albums: el[1],
    })) as unknown as UserAlbumsGroupedByUserId[];
  },
});

// Share user album mutation
export const useShareUserAlbumMutation = () => useMutation({
  mutationFn: async ({ albumId, userId, share }: ShareUserAlbumParams) => {
    await fetchClient.post('/useralbum/share/', { 
      shared: share, 
      album_id: albumId, 
      target_user_id: userId 
    });
    notification.toggleAlbumSharing(share);
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbum] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.sharedAlbumsByMe] });
  },
}); 