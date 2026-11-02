import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { sql } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { MirrorGrid, type GridItem } from "@/components/MirrorGrid";
import { Icon } from "@/components/Icon";
import { OptionSheet, type SheetOption } from "@/components/OptionSheet";
import { TextPromptModal } from "@/components/TextPromptModal";
import { useReactiveQuery } from "@/db/provider";
import type { AppDatabase } from "@/db/types";
import type { PhotoTileRow } from "@/db/queries/filters";
import { tileRowToItem } from "@/features/photos/FilterScreen";
import { useGridSelection } from "@/features/selection/useGridSelection";
import { useMutations } from "@/mutations/useMutations";
import { goBackOr } from "@/lib/navigation";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/toasts";
import { AlbumCoverPicker, type CoverCandidate } from "./AlbumCoverPicker";
import { canManageAlbum, useConfirmDeleteAlbum } from "./useDeleteAlbum";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useTheme } from "@/theme";
import { photoRoute } from "@/features/viewer/route";

/** One album's photos (user or auto), rendered from mirrored membership. */
export function AlbumDetailScreen({
  title,
  query,
  album,
}: {
  title: string;
  query: (db: AppDatabase) => PhotoTileRow[];
  /** When present + kind==='user', unlocks rename, cover, delete + remove-from-album. */
  album?: { id: number; kind: "user" | "auto" };
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const mutations = useMutations();
  // Only a user album has the ⋯ menu (rename, cover, delete) and remove-from-album.
  const userAlbumId = album?.kind === "user" ? album.id : undefined;

  const items = useReactiveQuery((db) => query(db).map(tileRowToItem), []);
  // Live album row (so a rename or a new cover reflects immediately).
  const albumRow = useReactiveQuery(
    (db) =>
      userAlbumId !== undefined
        ? (db.get(sql`SELECT title, owner_id, cover_hash FROM user_album WHERE id = ${userAlbumId}`) as
            | { title: string; owner_id: number | null; cover_hash: string | null }
            | undefined)
        : undefined,
    [userAlbumId]
  );
  const liveTitle = albumRow?.title ?? title;
  const userId = useAuthStore((s) => s.userId);
  // Someone else's album (shared with you) is theirs to change.
  const manageable = albumRow !== undefined && canManageAlbum(albumRow.owner_id, userId);
  const confirmDelete = useConfirmDeleteAlbum();
  const pushToast = useToastStore((s) => s.push);

  const selection = useGridSelection(
    {},
    userAlbumId !== undefined ? { albumId: userAlbumId, title: liveTitle } : undefined
  );
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);

  const coverCandidates: CoverCandidate[] = items.flatMap((item) =>
    item.photoId && item.imageHash ? [{ photoId: item.photoId, imageHash: item.imageHash }] : []
  );
  const pickCover = (photo: CoverCandidate | null) => {
    setPickingCover(false);
    if (userAlbumId === undefined) return;
    mutations.setAlbumCover(userAlbumId, photo?.photoId ?? null, photo?.imageHash ?? null);
    pushToast({ level: "info", message: t("albumDetail.coverSet") });
  };

  const menu: SheetOption[] =
    userAlbumId === undefined
      ? []
      : [
          {
            key: "rename",
            icon: "edit",
            label: t("mutations.renameAlbum"),
            disabled: !manageable,
            onPress: () => {
              setMenuOpen(false);
              setRenaming(true);
            },
          },
          {
            key: "cover",
            icon: "photo",
            label: t("albumDetail.setCover"),
            disabled: !manageable || coverCandidates.length === 0,
            onPress: () => {
              setMenuOpen(false);
              setPickingCover(true);
            },
          },
          {
            key: "delete",
            icon: "trash",
            label: t("albumDetail.deleteAlbum"),
            destructive: true,
            disabled: !manageable,
            onPress: () => {
              setMenuOpen(false);
              confirmDelete({ id: userAlbumId, title: liveTitle }, () => goBackOr(router, "/albums"));
            },
          },
        ];

  const openPhoto = useCallback(
    (item: GridItem) => {
      if (selection.active) {
        selection.toggle(item);
        return;
      }
      // Never a dead tap: a camera-roll asset has no image hash until it is
      // hashed, and the old `if (item.imageHash)` guard silently swallowed the
      // press so the viewer looked unimplemented. The viewer resolves a remote
      // id, an image hash, or a local asset id — and the tile it already has
      // rides along so the viewer can paint before it queries anything.
      router.push(photoRoute(item));
    },
    [router, selection]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScreenHeader
        title={liveTitle}
        fallback="/albums"
        testID="album-detail-title"
        right={
          userAlbumId !== undefined ? (
            <Pressable
              testID="album-menu-button"
              accessibilityRole="button"
              accessibilityLabel={t("albumDetail.menu")}
              onPress={() => setMenuOpen(true)}
              hitSlop={8}
              style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="more" size={22} color={theme.text} />
            </Pressable>
          ) : null
        }
      />
      <View style={{ flex: 1 }}>
        <MirrorGrid
          items={items}
          serverAddress={base}
          accessToken={token}
          onPressItem={openPhoto}
          onLongPressItem={selection.enter}
          selectionActive={selection.active}
          isSelected={selection.isSelected}
          ListEmptyComponent={
            <View testID="album-empty" style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ color: theme.muted }}>{t("albumDetail.empty")}</Text>
            </View>
          }
        />
      </View>
      {selection.overlay}
      {userAlbumId !== undefined ? (
        <TextPromptModal
          visible={renaming}
          title={t("mutations.renameAlbum")}
          initialValue={liveTitle}
          submitLabel={t("mutations.rename")}
          testID="album-rename-prompt"
          onSubmit={(value) => {
            setRenaming(false);
            if (value && value !== liveTitle) mutations.renameAlbum(userAlbumId, value);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : null}
      {userAlbumId !== undefined ? (
        <>
          <OptionSheet
            visible={menuOpen}
            title={liveTitle}
            options={menu}
            onClose={() => setMenuOpen(false)}
            testID="album-menu"
          />
          <AlbumCoverPicker
            visible={pickingCover}
            photos={coverCandidates}
            currentCoverHash={albumRow?.cover_hash ?? null}
            onPick={pickCover}
            onClose={() => setPickingCover(false)}
          />
        </>
      ) : null}
    </SafeAreaView>
  );
}
