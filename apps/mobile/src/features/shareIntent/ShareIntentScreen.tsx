import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDb } from "@/db/provider";
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
export function parseSharedItems(raw: string | string[] | undefined): SharedUploadItem[] {
  if (!raw) return [];
  const text = Array.isArray(raw) ? raw[0] : raw;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is { uri: string } => !!x && typeof (x as { uri?: unknown }).uri === "string")
      .map((x, i) => {
        const o = x as { uri: string; name?: string; type?: string };
        return { id: `shared:${o.uri}:${i}`, uri: o.uri, name: o.name ?? null, type: o.type ?? "image" };
      });
  } catch {
    return [];
  }
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
