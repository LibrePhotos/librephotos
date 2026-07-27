import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { mediaHeaders, squareThumbnailUrl } from "@librephotos/api-client";
import { useReactiveQuery } from "@/db/provider";
import { onThisDay } from "@/db/queries/memories";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";
import { photoRoute } from "@/features/viewer/route";

/**
 * "On this day" card for the top of the timeline (doc 05 §Memories). Pure mirror
 * query, horizontally scrollable; renders nothing when there are no memories.
 * Tapping a thumbnail opens the viewer; "See all" opens the memories screen.
 */
export function MemoriesCard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const headers = useMemo(() => mediaHeaders(token), [token]);

  // `onThisDay` reads remote_photo and nothing else, so a camera-roll scan
  // (local_asset / local_album_asset churn) must not re-run it — this card sits
  // in the timeline header, which is exactly what the user is scrolling.
  const memories = useReactiveQuery((db) => onThisDay(db, { limit: 20 }), [], ["remote_photo"]);
  const years = useMemo(() => [...new Set(memories.map((m) => m.year))], [memories]);

  if (memories.length === 0) return null;

  const oldest = Math.min(...years);
  const yearsAgo = new Date().getFullYear() - oldest;

  return (
    <View testID="memories-card" style={{ paddingTop: 8, paddingBottom: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginBottom: 8 }}>
        <View>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>{t("memories.title")}</Text>
          {yearsAgo > 0 ? (
            <Text style={{ color: theme.muted, fontSize: 12 }}>{t("memories.subtitle", { count: yearsAgo })}</Text>
          ) : null}
        </View>
        <Pressable testID="memories-see-all" onPress={() => router.push("/memories")} hitSlop={8}>
          <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("memories.seeAll")}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
        {memories.map((m) => (
          <Pressable
            key={m.id}
            testID={`memory-${m.image_hash}`}
            onPress={() => router.push(photoRoute({ key: m.image_hash, imageHash: m.image_hash }))}
          >
            <Image
              style={{ width: 120, height: 150, borderRadius: 10, backgroundColor: theme.card }}
              source={{ uri: squareThumbnailUrl(base, m.image_hash), headers }}
              contentFit="cover"
              cachePolicy="disk"
            />
            <View style={{ position: "absolute", left: 6, bottom: 6, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>{m.year}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
