import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { AlbumDetailScreen } from "@/features/albums/AlbumDetailScreen";
import { MyAlbumsScreen } from "@/features/albums/MyAlbumsScreen";
import { userAlbumPhotos } from "@/db/queries/albums";

/** My Albums: `all` shows the list, a numeric id shows one album's photos. */
export default function UserAlbumRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === "all" || id === undefined) {
    return <MyAlbumsScreen />;
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
