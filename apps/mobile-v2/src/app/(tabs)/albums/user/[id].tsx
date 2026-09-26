import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { AlbumsListScreen } from "@/features/albums/AlbumsListScreen";
import { AlbumDetailScreen } from "@/features/albums/AlbumDetailScreen";
import { userAlbums, userAlbumPhotos } from "@/db/queries/albums";

/** My Albums: `all` shows the list, a numeric id shows one album's photos. */
export default function UserAlbumRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === "all" || id === undefined) {
    return (
      <AlbumsListScreen
        title={t("explore.myAlbums")}
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
      title={t("albumDetail.fallbackAlbum")}
      query={(db) => userAlbumPhotos(db, albumId)}
      album={{ id: albumId, kind: "user" }}
    />
  );
}
