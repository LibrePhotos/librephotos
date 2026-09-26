import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { useLogoutMutation, useUserSelfDetailsQuery } from "@librephotos/api-client";
import { StatsCard } from "./StatsCard";
import { tokenStorage } from "@/lib/tokenStorage";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useReactiveQuery } from "@/db/provider";
import { pendingOutboxCount } from "@/mutations/outbox";
import { useTheme, type ThemeColors } from "@/theme";

/** Profile hub: identity + stats + navigation to settings / sharing / faces / server. */
export function ProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const onLoggedOut = useAuthStore((s) => s.onLoggedOut);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const user = useUserSelfDetailsQuery(userId ?? undefined);
  const pending = useReactiveQuery((db) => pendingOutboxCount(db), []);
  const isAdmin = user.data?.is_superuser === true;

  const logout = useLogoutMutation({
    getRefreshToken: () => tokenStorage.getRefreshToken(),
    onSuccess: async () => {
      await tokenStorage.clearTokens();
      onLoggedOut();
    },
  });

  const name = user.data
    ? `${user.data.first_name} ${user.data.last_name}`.trim() || user.data.username
    : "…";
  const photoCount = user.data?.photo_count ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: theme.text }}>{t("tabs.profile")}</Text>

        <View style={{ backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16 }}>
          <Text testID="profile-username" style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>
            {name}
          </Text>
          <Text style={{ color: theme.muted, marginTop: 2 }}>{serverUrl}</Text>
          {user.data ? (
            <Text testID="profile-storage" style={{ color: theme.muted, fontSize: 13, marginTop: 8 }}>
              {t("profile.storage", { photos: photoCount, videos: 0 })}
            </Text>
          ) : null}
        </View>

        <StatsCard />

        <Row testID="profile-settings-link" label={t("profile.settings")} onPress={() => router.push("/profile/settings")} theme={theme} />
        <Row testID="profile-sharing-link" label={t("profile.sharing")} onPress={() => router.push("/sharing")} theme={theme} />
        <Row testID="profile-faces-link" label={t("profile.faces")} onPress={() => router.push("/profile/faces")} theme={theme} />
        {isAdmin ? (
          <Row testID="profile-server-link" label={t("profile.server")} onPress={() => router.push("/profile/server")} theme={theme} />
        ) : null}
        <Row
          testID="sync-status-link"
          label={t("profile.syncStatus")}
          onPress={() => router.push("/profile/sync")}
          badge={pending > 0 ? pending : undefined}
          theme={theme}
        />

        <Pressable
          testID="logout-button"
          onPress={() => logout.mutate()}
          style={{ backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 6 }}
        >
          <Text style={{ color: "#dc2626", fontWeight: "600" }}>{t("profile.logout")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  onPress,
  badge,
  theme,
  testID,
}: {
  label: string;
  onPress: () => void;
  badge?: number;
  theme: ThemeColors;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{ backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingVertical: 16, paddingHorizontal: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
    >
      <Text style={{ color: theme.text, fontWeight: "600" }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {badge != null ? (
          <View style={{ backgroundColor: theme.brand, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{badge}</Text>
          </View>
        ) : null}
        <Text style={{ color: theme.muted }}>›</Text>
      </View>
    </Pressable>
  );
}
