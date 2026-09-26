import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { AlbumsListScreen } from "@/features/albums/AlbumsListScreen";
import { OnlineAlbumDetailScreen } from "@/features/albums/OnlineAlbumDetailScreen";
import { firstCoverHash, placeAlbumsList } from "@/db/queries/albums";

/** Places: `all` shows the mirrored list, a numeric id shows the online grid. */
export default function PlacesAlbumRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === "all" || id === undefined) {
    return (
      <AlbumsListScreen
        title={t("explore.places")}
        query={(db) =>
          placeAlbumsList(db).map((a) => ({
            id: a.id,
            title: a.title,
            coverHash: firstCoverHash(a.cover_hashes),
            photoCount: a.photo_count,
          }))
        }
        hrefFor={(albumId) => `/albums/places/${albumId}`}
        testID="places-list"
      />
    );
  }
  return <OnlineAlbumDetailScreen kind="place" id={id} />;
}
