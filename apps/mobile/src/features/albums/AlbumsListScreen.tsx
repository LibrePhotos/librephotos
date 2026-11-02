import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import { mediaHeaders, squareThumbnailUrl } from "@librephotos/api-client";
import { useReactiveQuery } from "@/db/provider";
import type { AppDatabase } from "@/db/types";
import { TextPromptModal } from "@/components/TextPromptModal";
import { useMutations } from "@/mutations/useMutations";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useTheme } from "@/theme";

export type AlbumCard = {
  id: number;
  title: string;
  coverHash: string | null;
  photoCount: number;
  /** User albums: who owns it (null for one made offline), for what long-press may offer. */
  ownerId?: number | null;
};

/** A grid of album cover cards (My Albums, Events), rendered from the mirror. */
export function AlbumsListScreen({
  title,
  query,
  hrefFor,
  creatable = false,
  queryDeps = [],
  headerActions,
  onLongPressItem,
  testID = "albums-list",
}: {
  title: string;
  query: (db: AppDatabase) => AlbumCard[];
  hrefFor: (id: number) => Href;
  /** My Albums: show a "New album" affordance (empty album, offline-capable). */
  creatable?: boolean;
  /** Re-run `query` when these change (e.g. the chosen sort). */
  queryDeps?: readonly unknown[];
  /** Extra header buttons, before "New album" (My Albums: the sort menu). */
  headerActions?: ReactNode;
  /** My Albums: long-press a card to delete the album. */
  onLongPressItem?: (album: AlbumCard) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const mutations = useMutations();
  const { width } = useWindowDimensions();
  const size = useMemo(() => Math.floor((width - 48) / 2), [width]);
  const headers = useMemo(() => mediaHeaders(token), [token]);
  const albums = useReactiveQuery(query, queryDeps);
  const [creating, setCreating] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScreenHeader
        title={title}
        fallback="/albums"
        right={
          headerActions || creatable ? (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {headerActions}
              {creatable ? (
                <Pressable testID="album-create-button" onPress={() => setCreating(true)} hitSlop={8} style={{ paddingHorizontal: 8 }}>
                  <Text style={{ color: theme.brand, fontWeight: "700" }}>+ {t("mutations.newAlbum")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
      />
      <FlashList
        testID={testID}
        data={albums}
        numColumns={2}
        keyExtractor={(a) => String(a.id)}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={
          <View testID="albums-empty" style={{ padding: 32, alignItems: "center" }}>
            <Text style={{ color: theme.muted }}>{t("explore.noAlbums")}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`album-${item.id}`}
            onPress={() => router.push(hrefFor(item.id))}
            onLongPress={onLongPressItem ? () => onLongPressItem(item) : undefined}
            style={{ width: size, margin: 4 }}
          >
            <Image
              testID={`album-cover-${item.id}`}
              style={{ width: size, height: size, borderRadius: 10, backgroundColor: theme.card }}
              source={item.coverHash ? { uri: squareThumbnailUrl(base, item.coverHash), headers } : undefined}
              contentFit="cover"
              cachePolicy="disk"
            />
            <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600", marginTop: 6 }}>
              {item.title}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 12 }}>
              {t("explore.photoCount", { count: item.photoCount })}
            </Text>
          </Pressable>
        )}
      />
      {creatable ? (
        <TextPromptModal
          visible={creating}
          title={t("mutations.newAlbum")}
          placeholder={t("mutations.albumName")}
          submitLabel={t("mutations.create")}
          testID="albums-create-prompt"
          onSubmit={(value) => {
            setCreating(false);
            if (value) mutations.createAlbum(value, []);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}
