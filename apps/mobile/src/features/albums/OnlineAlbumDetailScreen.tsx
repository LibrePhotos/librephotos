import { useMemo } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { sql } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import {
  useThingAlbumQuery,
  usePlaceAlbumQuery,
  useTagAlbumQuery,
} from "@librephotos/api-client";
import { OnlinePhotoGrid } from "@/components/OnlinePhotoGrid";
import { useReactiveQuery } from "@/db/provider";
import { flattenGroupedPhotos } from "@/lib/pigPhoto";
import { useTheme } from "@/theme";

export type AlbumKind = "thing" | "place" | "tag";

const MIRROR_TABLE: Record<AlbumKind, string> = {
  thing: "thing_album",
  place: "place_album",
  tag: "tag_album",
};

/**
 * A thing/place/tag album's photo grid. The album *lists* are mirrored, but
 * per-album membership is not (doc 02 §1) — so the grid is fetched online via
 * api-client with a clear offline state. The title comes from the mirror
 * (instant, offline-safe); the grid comes from the network.
 */
export function OnlineAlbumDetailScreen({ kind, id }: { kind: AlbumKind; id: string }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const thing = useThingAlbumQuery(kind === "thing" ? id : undefined);
  const place = usePlaceAlbumQuery(kind === "place" ? id : undefined);
  const tag = useTagAlbumQuery(kind === "tag" ? id : undefined);
  const query = kind === "thing" ? thing : kind === "place" ? place : tag;

  // Mirror title (offline-safe); fall back to the fetched album's title.
  const mirrorTitle = useReactiveQuery(
    (db) =>
      (
        db.get(
          sql.raw(`SELECT title FROM ${MIRROR_TABLE[kind]} WHERE id = ${Number(id) || 0}`)
        ) as { title: string } | undefined
      )?.title ?? null,
    [kind, id]
  );

  const items = useMemo(() => flattenGroupedPhotos(query.data?.grouped_photos), [query.data]);
  // Thing/place albums expose `title`; tag albums expose `name`.
  const fetchedTitle = query.data
    ? ("title" in query.data ? query.data.title : query.data.name)
    : null;
  const title = mirrorTitle ?? fetchedTitle ?? "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text testID="album-detail-title" numberOfLines={1} style={{ fontSize: 22, fontWeight: "700", color: theme.text }}>
          {title}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <OnlinePhotoGrid
          testID="album-detail-grid"
          items={items}
          isLoading={query.isLoading}
          isError={query.isError}
          offlineMessage={t("albumDetail.offline")}
          emptyMessage={t("albumDetail.empty")}
        />
      </View>
    </SafeAreaView>
  );
}
