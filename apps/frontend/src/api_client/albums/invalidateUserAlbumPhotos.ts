import { albumKeys, photoGridKeys } from "@librephotos/api-client";
import type { QueryClient } from "@tanstack/react-query";

// Photos joined or left one of my albums (added, removed, a new album, a deleted album): refresh
// the album list, that album's grid and the "Not in an album" list, which the photos enter or
// leave (#530).
export function invalidateUserAlbumPhotos(queryClient: QueryClient, albumId?: string) {
  void queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
  if (albumId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(albumId) });
  }
  void queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("notInAlbum") });
}
