import { useLocalSearchParams } from "expo-router";
import { AlbumsListScreen } from "@/features/albums/AlbumsListScreen";
import { AlbumDetailScreen } from "@/features/albums/AlbumDetailScreen";
import { userAlbums, userAlbumPhotos } from "@/db/queries/albums";

/** My Albums: `all` shows the list, a numeric id shows one album's photos. */
export default function UserAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === "all" || id === undefined) {
    return (
      <AlbumsListScreen
        title="My Albums"
        query={(db) =>
          userAlbums(db).map((a) => ({ id: a.id, title: a.title, coverHash: a.cover_hash, photoCount: a.photo_count }))
        }
        hrefFor={(albumId) => `/albums/user/${albumId}`}
        creatable
      />
    );
  }
  const albumId = Number(id);
  return (
    <AlbumDetailScreen
      title="Album"
      query={(db) => userAlbumPhotos(db, albumId)}
      album={{ id: albumId, kind: "user" }}
    />
  );
}
