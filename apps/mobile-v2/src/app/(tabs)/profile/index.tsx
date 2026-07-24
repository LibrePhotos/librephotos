import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useLogoutMutation, useUserSelfDetailsQuery } from "@librephotos/api-client";
import { tokenStorage } from "@/lib/tokenStorage";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useTheme } from "@/theme";

/**
 * Profile / settings hub (admin-lite, sharing hub, settings land later). For
 * Phase 0 it shows the signed-in user and a working logout that blacklists the
 * refresh token server-side and clears secure-store.
 */
export default function ProfileRoute() {
  const { t } = useTranslation();
  const theme = useTheme();
  const userId = useAuthStore((s) => s.userId);
  const onLoggedOut = useAuthStore((s) => s.onLoggedOut);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const user = useUserSelfDetailsQuery(userId ?? undefined);

  const logout = useLogoutMutation({
    getRefreshToken: () => tokenStorage.getRefreshToken(),
    onSuccess: async () => {
      await tokenStorage.clearTokens();
      onLoggedOut();
    },
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ flex: 1, padding: 24, gap: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: theme.text }}>{t("tabs.profile")}</Text>
        <Text testID="profile-username" style={{ color: theme.text, fontSize: 16 }}>
          {user.data ? `${user.data.first_name} ${user.data.last_name}`.trim() || user.data.username : "…"}
        </Text>
        <Text style={{ color: theme.muted }}>{serverUrl}</Text>

        <View style={{ flex: 1 }} />

        <Pressable
          testID="logout-button"
          onPress={() => logout.mutate()}
          style={{ backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingVertical: 14, alignItems: "center" }}
        >
          <Text style={{ color: "#dc2626", fontWeight: "600" }}>{t("profile.logout")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
