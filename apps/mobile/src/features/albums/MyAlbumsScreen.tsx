import { useState } from "react";
import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/Icon";
import { OptionSheet } from "@/components/OptionSheet";
import { userAlbums } from "@/db/queries/albums";
import { DEFAULT_USER_ALBUM_SORT, USER_ALBUM_SORTS, type UserAlbumSort } from "@/lib/albumSort";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useTheme } from "@/theme";
import { AlbumsListScreen } from "./AlbumsListScreen";
import { canManageAlbum, useConfirmDeleteAlbum } from "./useDeleteAlbum";

/** The menu's words for each order (`albumSort.<key>`). */
const SORT_LABEL_KEYS: Record<UserAlbumSort, string> = {
  name: "albumSort.name",
  created_desc: "albumSort.created_desc",
  created_asc: "albumSort.created_asc",
  count_desc: "albumSort.count_desc",
  updated_desc: "albumSort.updated_desc",
};

/**
 * My Albums ("View all"): the album grid with a sort menu in the header (the
 * choice persists on the device) and long-press to delete one of your albums.
 */
export function MyAlbumsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const sort = useSettingsStore((s) => s.albumSort);
  const setSort = useSettingsStore((s) => s.setAlbumSort);
  const userId = useAuthStore((s) => s.userId);
  const confirmDelete = useConfirmDeleteAlbum();
  const [sortOpen, setSortOpen] = useState(false);

  const sortButton = (
    <Pressable
      testID="albums-sort-button"
      accessibilityRole="button"
      accessibilityLabel={`${t("albumSort.button")}: ${t(SORT_LABEL_KEYS[sort])}`}
      onPress={() => setSortOpen(true)}
      hitSlop={8}
      style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
    >
      <Icon name="sort" size={22} color={sort === DEFAULT_USER_ALBUM_SORT ? theme.text : theme.brand} />
    </Pressable>
  );

  return (
    <>
      <AlbumsListScreen
        title={t("explore.myAlbums")}
        query={(db) =>
          userAlbums(db, sort).map((a) => ({
            id: a.id,
            title: a.title,
            coverHash: a.cover_hash,
            photoCount: a.photo_count,
            ownerId: a.owner_id,
          }))
        }
        queryDeps={[sort]}
        hrefFor={(albumId) => `/albums/user/${albumId}`}
        creatable
        headerActions={sortButton}
        onLongPressItem={(album) => {
          // Only what the server would allow: your own albums.
          if (canManageAlbum(album.ownerId ?? null, userId)) confirmDelete(album);
        }}
      />
      <OptionSheet
        visible={sortOpen}
        title={t("albumSort.title")}
        testID="albums-sort-sheet"
        onClose={() => setSortOpen(false)}
        options={USER_ALBUM_SORTS.map((key) => ({
          key,
          label: t(SORT_LABEL_KEYS[key]),
          selected: key === sort,
          onPress: () => {
            setSortOpen(false);
            setSort(key);
          },
        }))}
      />
    </>
  );
}
