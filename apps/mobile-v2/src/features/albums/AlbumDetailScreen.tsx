import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { sql } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { MirrorGrid, type GridItem } from "@/components/MirrorGrid";
import { TextPromptModal } from "@/components/TextPromptModal";
import { useReactiveQuery } from "@/db/provider";
import type { AppDatabase } from "@/db/types";
import type { PhotoTileRow } from "@/db/queries/filters";
import { tileRowToItem } from "@/features/photos/FilterScreen";
import { useGridSelection } from "@/features/selection/useGridSelection";
import { useMutations } from "@/mutations/useMutations";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";

/** One album's photos (user or auto), rendered from mirrored membership. */
export function AlbumDetailScreen({
  title,
  query,
  album,
}: {
  title: string;
  query: (db: AppDatabase) => PhotoTileRow[];
  /** When present + kind==='user', unlocks rename + remove-from-album. */
  album?: { id: number; kind: "user" | "auto" };
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const mutations = useMutations();
  const isUserAlbum = album?.kind === "user";

  const items = useReactiveQuery((db) => query(db).map(tileRowToItem), []);
  // Live album title (so a rename reflects immediately).
  const liveTitle = useReactiveQuery(
    (db) =>
      isUserAlbum
        ? ((db.get(sql`SELECT title FROM user_album WHERE id = ${album!.id}`) as { title: string } | undefined)
            ?.title ?? title)
        : title,
    [album?.id, title, isUserAlbum]
  );

  const selection = useGridSelection(
    {},
    isUserAlbum ? { albumId: album!.id, title: liveTitle } : undefined
  );
  const [renaming, setRenaming] = useState(false);

  const openPhoto = useCallback(
    (item: GridItem) => {
      if (selection.active) {
        selection.toggle(item);
        return;
      }
      // Never a dead tap: a camera-roll asset has no image hash until it is
      // hashed, and the old `if (item.imageHash)` guard silently swallowed the
      // press so the viewer looked unimplemented. The viewer resolves a remote
      // id, an image hash, or a local asset id.
      router.push(`/photo/${item.imageHash ?? item.key}`);
    },
    [router, selection]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text testID="album-detail-title" numberOfLines={1} style={{ fontSize: 22, fontWeight: "700", color: theme.text, flex: 1 }}>
          {liveTitle}
        </Text>
        {isUserAlbum ? (
          <Pressable testID="album-rename-button" onPress={() => setRenaming(true)} hitSlop={8}>
            <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("mutations.rename")}</Text>
          </Pressable>
        ) : null}
      </View>
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
              <Text style={{ color: theme.muted }}>No photos in this album.</Text>
            </View>
          }
        />
      </View>
      {selection.overlay}
      {isUserAlbum ? (
        <TextPromptModal
          visible={renaming}
          title={t("mutations.renameAlbum")}
          initialValue={liveTitle}
          submitLabel={t("mutations.rename")}
          testID="album-rename-prompt"
          onSubmit={(value) => {
            setRenaming(false);
            if (value && value !== liveTitle) mutations.renameAlbum(album!.id, value);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}
