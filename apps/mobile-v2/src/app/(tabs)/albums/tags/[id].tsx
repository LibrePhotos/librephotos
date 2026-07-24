import { useLocalSearchParams } from "expo-router";
import { AlbumsListScreen } from "@/features/albums/AlbumsListScreen";
import { OnlineAlbumDetailScreen } from "@/features/albums/OnlineAlbumDetailScreen";
import { firstCoverHash, tagAlbumsList } from "@/db/queries/albums";

/** Tags: `all` shows the mirrored list, a numeric id shows the online grid. */
export default function TagsAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === "all" || id === undefined) {
    return (
      <AlbumsListScreen
        title="Tags"
        query={(db) =>
          tagAlbumsList(db).map((a) => ({
            id: a.id,
            title: a.title,
            coverHash: firstCoverHash(a.cover_hashes),
            photoCount: a.photo_count,
          }))
        }
        hrefFor={(albumId) => `/albums/tags/${albumId}`}
        testID="tags-list"
      />
    );
  }
  return <OnlineAlbumDetailScreen kind="tag" id={id} />;
}
