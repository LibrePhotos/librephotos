import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { z } from "zod";
import { useDb } from "@/db/provider";
import { parseJson } from "@/lib/guards";
import { goBackOr } from "@/lib/navigation";
import { enqueueSharedUploads, type SharedUploadItem } from "@/sync/upload/shared";
import { runSync } from "@/sync/run";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/toasts";
import { useTheme } from "@/theme";

/**
 * "Upload to LibrePhotos" share-target screen (doc 05 §Share-sheet target). The
 * shared items arrive as a JSON `items` route param (delivered by the Android
 * intent filter via expo-share-intent at prebuild; iOS is a prebuild-time
 * addition). Each item is enqueued as a one-off upload through the existing
 * upload worker path — NOT the camera-roll backup queue.
 */
const SharedItemsParam = z.array(z.unknown());

/** One shared item: a uri is required; a name or type of the wrong kind is dropped. */
const SharedItemParam = z.object({
  uri: z.string(),
  name: z.string().optional().catch(undefined),
  type: z.string().optional().catch(undefined),
});

export function parseSharedItems(raw: string | string[] | undefined): SharedUploadItem[] {
  if (!raw) return [];
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return [];
  let list: unknown[];
  try {
    const parsed = SharedItemsParam.safeParse(parseJson(text));
    if (!parsed.success) return [];
    list = parsed.data;
  } catch {
    return [];
  }
  return list
    .flatMap((x) => {
      const item = SharedItemParam.safeParse(x);
      return item.success ? [item.data] : [];
    })
    .map((o, i) => ({ id: `shared:${o.uri}:${i}`, uri: o.uri, name: o.name ?? null, type: o.type ?? "image" }));
}

export function ShareIntentScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDb();
  const userId = useAuthStore((s) => s.userId);
  const pushToast = useToastStore((s) => s.push);
  const params = useLocalSearchParams<{ items?: string }>();
  const items = useMemo(() => parseSharedItems(params.items), [params.items]);
  const [uploading, setUploading] = useState(false);

  const onUpload = () => {
    if (items.length === 0) return;
    setUploading(true);
    const queued = enqueueSharedUploads(db, items);
    pushToast({ level: "info", message: t("shareIntent.queued") });
    if (userId != null) void runSync(db, { userId, reason: "manual" });
    void queued;
    router.replace("/backup");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ fontSize: 22, fontWeight: "700", color: theme.text }}>{t("shareIntent.title")}</Text>
        <Text testID="share-count" style={{ color: theme.muted, marginTop: 4 }}>
          {t("shareIntent.count", { count: items.length })}
        </Text>
      </View>

      {items.length === 0 ? (
        <View testID="share-empty" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ color: theme.muted }}>{t("shareIntent.empty")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", padding: 12, gap: 8 }}>
          {items.map((item) => (
            <Image
              key={item.id}
              testID={`share-thumb-${item.id}`}
              style={{ width: 100, height: 100, borderRadius: 8, backgroundColor: theme.card }}
              source={{ uri: item.uri }}
              contentFit="cover"
            />
          ))}
        </ScrollView>
      )}

      <View style={{ padding: 16, gap: 10 }}>
        <Pressable
          testID="share-upload"
          onPress={onUpload}
          disabled={items.length === 0 || uploading}
          style={{ backgroundColor: theme.brand, borderRadius: 10, paddingVertical: 14, alignItems: "center", opacity: items.length === 0 || uploading ? 0.5 : 1 }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>{t("shareIntent.upload")}</Text>
        </Pressable>
        <Pressable testID="share-cancel" onPress={() => goBackOr(router, "/photos")} style={{ paddingVertical: 8, alignItems: "center" }}>
          <Text style={{ color: theme.muted }}>{t("common.cancel")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
