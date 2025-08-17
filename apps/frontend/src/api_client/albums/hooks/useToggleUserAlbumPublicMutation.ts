import { useMutation } from '@tanstack/react-query';

import { fetchClient, queryClient } from '../../api';
import { UserAlbumQueryKeys } from './useFetchUserAlbumQuery';
import { UserAlbumsQueryKeys } from './useFetchUserAlbumsQuery';

type ToggleUserAlbumPublicParams = {
  albumId: string;
  public: boolean;
  slug?: string;
  expires_at?: string | null; // ISO
};

export const useToggleUserAlbumPublicMutation = () => useMutation({
  mutationFn: async ({ albumId, public: isPublic, slug, expires_at }: ToggleUserAlbumPublicParams) => {
    await fetchClient.post('/useralbum/makepublic', {
      album_id: albumId,
      val_public: isPublic,
      slug,
      expires_at,
    });
  },
  onSuccess: (_, { albumId }) => {
    queryClient.invalidateQueries({ queryKey: [...UserAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...UserAlbumQueryKeys, albumId] });
  },
});


