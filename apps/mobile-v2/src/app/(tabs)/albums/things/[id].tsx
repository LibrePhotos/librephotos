import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { AlbumsListScreen } from "@/features/albums/AlbumsListScreen";
import { OnlineAlbumDetailScreen } from "@/features/albums/OnlineAlbumDetailScreen";
import { firstCoverHash, thingAlbumsList } from "@/db/queries/albums";

/** Things: `all` shows the mirrored list, a numeric id shows the online grid. */
export default function ThingsAlbumRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === "all" || id === undefined) {
    return (
      <AlbumsListScreen
        title={t("explore.things")}
        query={(db) =>
          thingAlbumsList(db).map((a) => ({
            id: a.id,
            title: a.title,
            coverHash: firstCoverHash(a.cover_hashes),
            photoCount: a.photo_count,
          }))
        }
        hrefFor={(albumId) => `/albums/things/${albumId}`}
        testID="things-list"
      />
    );
  }
  return <OnlineAlbumDetailScreen kind="thing" id={id} />;
}
