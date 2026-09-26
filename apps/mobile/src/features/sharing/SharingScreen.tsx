import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import {
  useSharedAlbumsByMeQuery,
  useSharedAlbumsWithMeQuery,
  useSharedPhotosByMeQuery,
  useSharedPhotosWithMeQuery,
} from "@librephotos/api-client";
import { OnlinePhotoGrid } from "@/components/OnlinePhotoGrid";
import { pigPhotoToItem } from "@/lib/pigPhoto";
import { useTheme } from "@/theme";

type Tab = "byMe" | "withMe";

/**
 * Sharing hub (doc 05 §Sharing). Toggle between shared-by-me and shared-with-me;
 * each shows shared albums (list) + shared photos (grid), fetched online with a
 * clear offline state. Share/unshare actions live on the photo grids' selection
 * bar (ShareSheet); this screen is the read surface.
 */
export function SharingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("byMe");

  const photosByMe = useSharedPhotosByMeQuery(tab === "byMe");
  const photosWithMe = useSharedPhotosWithMeQuery(tab === "withMe");
  const albumsByMe = useSharedAlbumsByMeQuery(tab === "byMe");
  const albumsWithMe = useSharedAlbumsWithMeQuery(tab === "withMe");

  const photosQuery = tab === "byMe" ? photosByMe : photosWithMe;
  const albumsQuery = tab === "byMe" ? albumsByMe : albumsWithMe;

  const items = useMemo(() => {
    if (tab === "byMe") return (photosByMe.data ?? []).map((s) => pigPhotoToItem(s.photo));
    return (photosWithMe.data ?? []).map(pigPhotoToItem);
  }, [tab, photosByMe.data, photosWithMe.data]);

  const albums = albumsQuery.data ?? [];

  const header = (
    <View>
      {albums.length > 0 ? (
        <View style={{ paddingBottom: 8 }}>
          <Text style={{ paddingHorizontal: 16, paddingVertical: 6, color: theme.muted, fontWeight: "600", fontSize: 13 }}>
            {t("sharing.albums")}
          </Text>
          {albums.map((a) => (
            <Pressable
              key={a.id}
              testID={`shared-album-${a.id}`}
              onPress={() => router.push(`/albums/user/${a.id}`)}
              style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between" }}
            >
              <Text style={{ color: theme.text }} numberOfLines={1}>
                {a.title}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>
                {tab === "byMe"
                  ? t("sharing.sharedWith", { name: `${a.shared_to.length}` })
                  : t("sharing.sharedBy", { name: `${a.owner.first_name || a.owner.username}` })}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {items.length > 0 ? (
        <Text style={{ paddingHorizontal: 16, paddingVertical: 6, color: theme.muted, fontWeight: "600", fontSize: 13 }}>
          {t("sharing.photos")}
        </Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: theme.text, marginBottom: 12 }}>{t("sharing.title")}</Text>
        <View style={{ flexDirection: "row", backgroundColor: theme.card, borderRadius: 10, padding: 4 }}>
          {(["byMe", "withMe"] as const).map((key) => (
            <Pressable
              key={key}
              testID={`sharing-tab-${key}`}
              onPress={() => setTab(key)}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: tab === key ? theme.background : "transparent", alignItems: "center" }}
            >
              <Text style={{ color: tab === key ? theme.text : theme.muted, fontWeight: "600" }}>
                {key === "byMe" ? t("sharing.byMe") : t("sharing.withMe")}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <OnlinePhotoGrid
          testID="sharing-grid"
          items={items}
          isLoading={photosQuery.isLoading || albumsQuery.isLoading}
          isError={photosQuery.isError}
          emptyMessage={tab === "byMe" ? t("sharing.emptyByMe") : t("sharing.emptyWithMe")}
          ListHeaderComponent={header}
        />
      </View>
    </SafeAreaView>
  );
}
