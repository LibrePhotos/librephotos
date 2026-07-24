import { useLocalSearchParams } from "expo-router";
import { AlbumsListScreen } from "@/features/albums/AlbumsListScreen";
import { AlbumDetailScreen } from "@/features/albums/AlbumDetailScreen";
import { autoAlbums, autoAlbumPhotos } from "@/db/queries/albums";

/** Events (auto albums): `all` shows the list, a numeric id shows one event. */
export default function EventsAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === "all" || id === undefined) {
    return (
      <AlbumsListScreen
        title="Events"
        query={(db) =>
          autoAlbums(db).map((a) => ({ id: a.id, title: a.title, coverHash: a.cover_hash, photoCount: a.photo_count }))
        }
        hrefFor={(albumId) => `/albums/events/${albumId}`}
        testID="events-list"
      />
    );
  }
  const albumId = Number(id);
  return <AlbumDetailScreen title="Event" query={(db) => autoAlbumPhotos(db, albumId)} />;
}
