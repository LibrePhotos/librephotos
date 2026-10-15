import type {
  AutoAlbumInfo,
  FolderSubfolder,
  PlaceAlbumInfo,
  TagList,
  ThingAlbumInfo,
  UserAlbumInfo,
} from "@librephotos/api-client";
import type { Person } from "../../api_client/albums/hooks";
import { parsePhotoTimestamp } from "../../util/dateUtils";
import { STORAGE_KEYS } from "../../util/storage";
import type { AlbumSortConfig, AlbumSortOption } from "./albumSort";
import { eventStartDate } from "./eventDate";

/**
 * The sort options of each album list (#620). Every default is the order the page had before it
 * could be sorted.
 */

type Titled = Readonly<{ title: string; photo_count: number }>;

function titleAndCount<T extends Titled>(): AlbumSortOption<T>[] {
  return [
    { key: "name", value: item => item.title },
    { key: "count", value: item => item.photo_count },
  ];
}

export const USER_ALBUM_SORT: AlbumSortConfig<UserAlbumInfo> = {
  storageKey: STORAGE_KEYS.albumSortUserAlbums,
  // The server lists them by title
  defaultSort: { key: "name", direction: "asc" },
  options: [
    ...titleAndCount<UserAlbumInfo>(),
    {
      key: "date",
      // When the oldest photo was taken, not when the album was made (the issue's ask)
      value: album => (album.first_photo_date ? parsePhotoTimestamp(album.first_photo_date).toMillis() : null),
      // Servers before #620 do not send it
      isAvailable: albums => albums.some(album => album.first_photo_date !== undefined),
    },
  ],
};

/** Events need their title worded in the UI language, which is what the cards show. */
export function eventSortConfig(eventTitle: (album: AutoAlbumInfo) => string): AlbumSortConfig<AutoAlbumInfo> {
  return {
    storageKey: STORAGE_KEYS.albumSortEvents,
    defaultSort: { key: "date", direction: "desc" },
    options: [
      { key: "date", value: album => eventStartDate(album).toMillis() },
      { key: "name", value: eventTitle },
      { key: "count", value: album => album.photo_count },
    ],
  };
}

export const THING_SORT: AlbumSortConfig<ThingAlbumInfo> = {
  storageKey: STORAGE_KEYS.albumSortThings,
  defaultSort: { key: "name", direction: "asc" },
  options: titleAndCount<ThingAlbumInfo>(),
};

export const PLACE_SORT: AlbumSortConfig<PlaceAlbumInfo> = {
  storageKey: STORAGE_KEYS.albumSortPlaces,
  // Countries first, and within a level the places with the most photos
  defaultSort: { key: "size", direction: "asc" },
  options: [{ key: "size", value: place => place.geolocation_level }, ...titleAndCount<PlaceAlbumInfo>()],
};

export const PEOPLE_SORT: AlbumSortConfig<Person> = {
  storageKey: STORAGE_KEYS.albumSortPeople,
  defaultSort: { key: "name", direction: "asc" },
  options: [
    { key: "name", value: person => person.name },
    // face_count counts faces, not photos, so the label says faces
    { key: "count", label: "albumsort.faces", value: person => person.face_count },
  ],
};

export const TAG_SORT: AlbumSortConfig<TagList[number]> = {
  storageKey: STORAGE_KEYS.albumSortTags,
  defaultSort: { key: "name", direction: "asc" },
  options: [
    { key: "name", value: tag => tag.name },
    { key: "count", value: tag => tag.photo_count },
  ],
};

export const FOLDER_SORT: AlbumSortConfig<FolderSubfolder> = {
  storageKey: STORAGE_KEYS.albumSortFolders,
  defaultSort: { key: "name", direction: "asc" },
  options: [
    { key: "name", value: folder => folder.name },
    { key: "count", value: folder => folder.photo_count },
  ],
};
