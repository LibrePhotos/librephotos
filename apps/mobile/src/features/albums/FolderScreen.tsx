import { useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import {
  Photoset,
  useDateAlbumPhotoChunksQuery,
  useFolderSubfoldersQuery,
  type FolderSubfolder,
} from "@librephotos/api-client";
import { MirrorGrid, type GridItem } from "@/components/MirrorGrid";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Icon } from "@/components/Icon";
import { useGridSelection } from "@/features/selection/useGridSelection";
import { photoRoute } from "@/features/viewer/route";
import { useAccessToken } from "@/hooks/use-access-token";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { serverAddress } from "@/lib/apiClient";
import { pigPhotoToItem } from "@/lib/pigPhoto";
import { useTheme } from "@/theme";

/** The route id of the scan directory itself (Collections → Folders → View all). */
export const ROOT_FOLDER_ID = "root";

/** The last segment of a server path, which on Windows mixes \ and /. */
export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * The server's folder tree (web `/album/folder` and `/album/folder/$id`): the
 * folder's name in the header and its full path under it, its subfolders as
 * rows (tap one to go in), then the photos in it as a grid with multi-select.
 * The top level (`root`, the scan directory) lists folders only, as the web
 * does. There is no mirror of the directory tree, so this is online-only, with
 * an offline state when nothing was loaded before.
 */
export function FolderScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const isOnline = useOnlineStatus();
  const path = id === ROOT_FOLDER_ID ? undefined : id;

  const listing = useFolderSubfoldersQuery(path);
  const photos = useDateAlbumPhotoChunksQuery(Photoset.NONE, { folder: path }, { enabled: path !== undefined });
  const selection = useGridSelection();

  const subfolders = useMemo(() => listing.data?.results ?? [], [listing.data]);
  const items = useMemo(
    () => photos.data?.pages.flatMap((page) => page.photos.map(pigPhotoToItem)) ?? [],
    [photos.data]
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = photos;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const title = path ? folderName(path) : t("explore.folders");
  const currentPath = listing.data?.current_path ?? path ?? null;

  const openFolder = useCallback(
    (folder: FolderSubfolder) => router.push({ pathname: "/albums/folders/[id]", params: { id: folder.path } }),
    [router]
  );
  const openPhoto = useCallback(
    (item: GridItem) => {
      if (selection.active) {
        selection.toggle(item);
        return;
      }
      router.push(photoRoute(item));
    },
    [router, selection]
  );

  const nothing = subfolders.length === 0 && items.length === 0;
  const photosLoading = path !== undefined && photos.isLoading;

  let body;
  if (!isOnline && nothing) {
    body = (
      <View testID="folder-offline" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: theme.text, fontWeight: "600", marginBottom: 6 }}>{t("common.offline")}</Text>
        <Text style={{ color: theme.muted, textAlign: "center" }}>{t("explore.foldersOffline")}</Text>
      </View>
    );
  } else if ((listing.isLoading || photosLoading) && nothing) {
    body = (
      <View testID="folder-loading" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  } else if ((listing.isError || photos.isError) && nothing) {
    body = (
      <View testID="folder-error" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: theme.muted }}>{t("common.error")}</Text>
      </View>
    );
  } else {
    const header = (
      <View>
        {subfolders.map((folder) => (
          <Pressable
            key={folder.path}
            testID={`folder-row-${folder.name}`}
            accessibilityRole="button"
            onPress={() => openFolder(folder)}
            style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12 }}
          >
            <Icon name="folders" size={24} color={theme.brand} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 16 }}>
                {folder.name}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>{t("explore.photoCount", { count: folder.photo_count })}</Text>
            </View>
            <Icon name="viewAll" size={18} color={theme.muted} />
          </Pressable>
        ))}
        {subfolders.length > 0 && items.length > 0 ? (
          <Text style={{ color: theme.muted, fontWeight: "600", fontSize: 13, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
            {t("folder.photos")}
          </Text>
        ) : null}
      </View>
    );
    body = (
      <MirrorGrid
        testID="folder-grid"
        items={items}
        serverAddress={base}
        accessToken={token}
        onPressItem={openPhoto}
        onLongPressItem={selection.enter}
        selectionActive={selection.active}
        isSelected={selection.isSelected}
        onEndReached={loadMore}
        ListHeaderComponent={header}
        ListEmptyComponent={
          photosLoading ? (
            <ActivityIndicator style={{ padding: 32 }} color={theme.brand} />
          ) : subfolders.length === 0 ? (
            <View testID="folder-empty" style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ color: theme.muted }}>{path ? t("folder.empty") : t("folder.noFolders")}</Text>
            </View>
          ) : null
        }
      />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScreenHeader title={title} fallback="/albums" testID="folder-title" />
      {currentPath ? (
        <Text
          testID="folder-path"
          numberOfLines={1}
          ellipsizeMode="head"
          style={{ color: theme.muted, fontSize: 12, paddingHorizontal: 16, marginTop: -6, paddingBottom: 8 }}
        >
          {currentPath}
        </Text>
      ) : null}
      <View style={{ flex: 1 }}>{body}</View>
      {selection.overlay}
    </SafeAreaView>
  );
}
