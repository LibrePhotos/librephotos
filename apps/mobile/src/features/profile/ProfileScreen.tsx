import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import { useLogoutMutation, useUserSelfDetailsQuery } from "@librephotos/api-client";
import { StatsCard } from "./StatsCard";
import { AccountButton } from "@/features/account/AccountButton";
import { backupRing } from "@/features/account/backupRing";
import { stageText, useBackupState } from "@/features/backup/backupStatus";
import { Icon, type IconName } from "@/components/Icon";
import { ScreenHeader } from "@/components/ScreenHeader";
import { tokenStorage } from "@/lib/tokenStorage";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useReactiveQuery } from "@/db/provider";
import { pendingOutboxCount } from "@/mutations/outbox";
import { useTheme, type ThemeColors } from "@/theme";

/**
 * The account screen, opened from the avatar on the main screens. It took over
 * the old Backup and Profile tabs: who you are, how backup is doing, and the
 * way to settings, sharing, faces, the server and sync status.
 */
export function ProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const onLoggedOut = useAuthStore((s) => s.onLoggedOut);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const user = useUserSelfDetailsQuery(userId ?? undefined);
  const pending = useReactiveQuery((db) => pendingOutboxCount(db), []);
  const backup = useBackupState();
  const ring = backupRing(backup);
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
  const backupLine = ring.tone === "off" ? t("account.backupOff") : stageText(t, backup.stage);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScreenHeader title={t("account.title")} fallback="/photos" closeIcon testID="account-title" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 }}>
          <View pointerEvents="none">
            <AccountButton />
          </View>
          <View style={{ flex: 1 }}>
            <Text testID="profile-username" style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>
              {name}
            </Text>
            <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 13 }}>
              {serverUrl}
            </Text>
          </View>
        </View>

        <Pressable
          testID="account-backup-link"
          onPress={() => router.push("/profile/backup")}
          style={{ backgroundColor: theme.card, borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}
        >
          <Icon name="backup" size={24} color={ring.tone === "error" ? "#dc2626" : theme.brand} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16 }}>{t("account.backup")}</Text>
            <Text testID="account-backup-status" style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
              {backupLine}
            </Text>
          </View>
          <Icon name="viewAll" size={18} color={theme.muted} />
        </Pressable>

        <StatsCard />

        <View style={{ backgroundColor: theme.card, borderRadius: 14, overflow: "hidden" }}>
          <Row testID="profile-settings-link" icon="settings" label={t("account.settings")} href="/profile/settings" theme={theme} />
          <Row testID="profile-sharing-link" icon="sharing" label={t("account.sharing")} href="/sharing" theme={theme} />
          <Row testID="profile-faces-link" icon="faces" label={t("account.faces")} href="/profile/faces" theme={theme} />
          {isAdmin ? (
            <Row testID="profile-server-link" icon="server" label={t("account.server")} href="/profile/server" theme={theme} />
          ) : null}
          <Row
            testID="sync-status-link"
            icon="sync"
            label={t("account.syncStatus")}
            href="/profile/sync"
            badge={pending > 0 ? pending : undefined}
            theme={theme}
            last
          />
        </View>

        <Pressable
          testID="logout-button"
          onPress={() => logout.mutate()}
          style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 14, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 }}
        >
          <Icon name="logout" size={18} color="#dc2626" />
          <Text style={{ color: "#dc2626", fontWeight: "600" }}>{t("account.logout")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  icon,
  href,
  badge,
  theme,
  testID,
  last = false,
}: {
  label: string;
  icon: IconName;
  href: Href;
  badge?: number;
  theme: ThemeColors;
  testID: string;
  last?: boolean;
}) {
  const router = useRouter();
  return (
    <Pressable
      testID={testID}
      onPress={() => router.push(href)}
      style={{
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.border,
      }}
    >
      <Icon name={icon} size={20} color={theme.text} />
      <Text style={{ color: theme.text, fontWeight: "600", flex: 1 }}>{label}</Text>
      {badge != null ? (
        <View style={{ backgroundColor: theme.brand, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{badge}</Text>
        </View>
      ) : null}
      <Icon name="viewAll" size={18} color={theme.muted} />
    </Pressable>
  );
}
