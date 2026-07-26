import { useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { endpoints, useApiClient, useUserSelfDetailsQuery } from "@librephotos/api-client";
import { changeAppLanguage, AVAILABLE_LOCALES } from "@/i18n";
import { TextPromptModal } from "@/components/TextPromptModal";
import { useDb, useReactiveQuery } from "@/db/provider";
import { getBackupConfig, setBackupConfig } from "@/db/queries/backup";
import { formatTime, getMemoriesNotifPrefs, setMemoriesNotifPrefs } from "@/db/queries/memories";
import { cancelMemoriesReminder, scheduleMemoriesReminder } from "@/features/memories/notifications";
import { clearThumbCache, thumbCacheTotalBytes } from "@/sync/thumbs";
import { runSync } from "@/sync/run";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore, type ThemePreference } from "@/stores/settings";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToastStore } from "@/stores/toasts";
import { formatBytes } from "@/lib/format";
import { goBackOr } from "@/lib/navigation";
import { useTheme, type ThemeColors } from "@/theme";

/** GB choices for the thumbnail-cache cap. */
const CAP_CHOICES_GB = [1, 2, 5, 10];

/**
 * Settings (doc 05 §5). App preferences (theme, language, thumb cache, backup
 * rules) are local; server preferences (favorite threshold, scan, password) are
 * online-only via api-client. `favorite_min_rating` changes trigger the existing
 * reseed path on the next sync.
 */
export function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDb();
  const client = useApiClient();
  const isOnline = useOnlineStatus();
  const pushToast = useToastStore((s) => s.push);
  const userId = useAuthStore((s) => s.userId);
  const user = useUserSelfDetailsQuery(userId ?? undefined);

  const themePref = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const capBytes = useSettingsStore((s) => s.thumbCapBytes);
  const setCap = useSettingsStore((s) => s.setThumbCapBytes);

  const cacheBytes = useReactiveQuery((d) => thumbCacheTotalBytes(d), []);
  const backup = useReactiveQuery((d) => getBackupConfig(d), []);
  const memoriesNotif = useReactiveQuery((d) => getMemoriesNotifPrefs(d), []);

  const [langOpen, setLangOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);

  const reminderContent = {
    title: t("memories.notificationTitle"),
    body: t("memories.notificationBody"),
  };

  const toggleMemoriesNotif = async (enabled: boolean) => {
    setMemoriesNotifPrefs(db, { enabled });
    if (enabled) {
      const ok = await scheduleMemoriesReminder(memoriesNotif.hour, memoriesNotif.minute, reminderContent);
      if (!ok) {
        setMemoriesNotifPrefs(db, { enabled: false });
        pushToast({ level: "error", message: t("common.error") });
      }
    } else {
      await cancelMemoriesReminder();
    }
  };

  const setReminderTime = async (value: string) => {
    setEditingTime(false);
    const m = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return;
    const hour = Math.min(23, Number(m[1]));
    const minute = Math.min(59, Number(m[2]));
    setMemoriesNotifPrefs(db, { hour, minute });
    if (memoriesNotif.enabled) await scheduleMemoriesReminder(hour, minute, reminderContent);
  };

  const favoriteMinRating = user.data?.favorite_min_rating ?? 4;

  const setFavoriteMinRating = async (value: number) => {
    if (!userId) return;
    setRatingBusy(true);
    try {
      await endpoints.updateUserPartial(client, userId, { favorite_min_rating: value });
      pushToast({ level: "info", message: t("settings.saved") });
      void user.refetch();
      // A threshold change re-derives is_favorite server-side; the next sync
      // detects it and reseeds the mirror.
      void runSync(db, { userId, reason: "refresh" });
    } catch {
      pushToast({ level: "error", message: t("settings.saveError") });
    } finally {
      setRatingBusy(false);
    }
  };

  const changePassword = async (password: string) => {
    setChangingPassword(false);
    if (!userId || !password) return;
    try {
      await endpoints.updateUserPartial(client, userId, { password });
      pushToast({ level: "info", message: t("profile.passwordChanged") });
    } catch {
      pushToast({ level: "error", message: t("profile.passwordError") });
    }
  };

  const scan = async () => {
    try {
      await endpoints.scanPhotos(client);
      pushToast({ level: "info", message: t("settings.scanQueued") });
    } catch {
      pushToast({ level: "error", message: t("settings.saveError") });
    }
  };

  const clearCache = () => {
    clearThumbCache(db);
    pushToast({ level: "info", message: t("settings.cacheCleared") });
  };

  const pickLanguage = (code: string) => {
    setLangOpen(false);
    setLocale(code);
    void changeAppLanguage(code);
  };

  const localeLabel = useMemo(
    () => AVAILABLE_LOCALES.find((l) => l.code === locale)?.label ?? locale,
    [locale]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
        <Pressable testID="settings-back" onPress={() => goBackOr(router, "/profile")} hitSlop={8}>
          <Text style={{ color: theme.brand, fontSize: 16 }}>‹</Text>
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: "700", color: theme.text }}>{t("settings.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
        {/* App preferences */}
        <Section title={t("settings.app")} theme={theme}>
          <Text style={{ color: theme.muted, fontSize: 13, marginBottom: 6 }}>{t("settings.theme")}</Text>
          <View style={{ flexDirection: "row", backgroundColor: theme.background, borderRadius: 8, padding: 4 }}>
            {(["system", "light", "dark"] as ThemePreference[]).map((opt) => (
              <Pressable
                key={opt}
                testID={`theme-${opt}`}
                onPress={() => setTheme(opt)}
                style={{ flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: "center", backgroundColor: themePref === opt ? theme.brand : "transparent" }}
              >
                <Text style={{ color: themePref === opt ? "#fff" : theme.text, fontWeight: "600" }}>
                  {opt === "system" ? t("settings.themeSystem") : opt === "light" ? t("settings.themeLight") : t("settings.themeDark")}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            testID="settings-language"
            onPress={() => setLangOpen((v) => !v)}
            style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 14, marginTop: 8 }}
          >
            <Text style={{ color: theme.text }}>{t("settings.language")}</Text>
            <Text style={{ color: theme.muted }}>{localeLabel} ›</Text>
          </Pressable>
          {langOpen ? (
            <View testID="language-list" style={{ maxHeight: 240 }}>
              <ScrollView>
                {AVAILABLE_LOCALES.map((l) => (
                  <Pressable
                    key={l.code}
                    testID={`language-${l.code}`}
                    onPress={() => pickLanguage(l.code)}
                    style={{ paddingVertical: 10, borderBottomColor: theme.border, borderBottomWidth: 1 }}
                  >
                    <Text style={{ color: l.code === locale ? theme.brand : theme.text }}>{l.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </Section>

        {/* Thumbnail cache */}
        <Section title={t("settings.thumbCache")} theme={theme}>
          <Text testID="cache-usage" style={{ color: theme.muted, fontSize: 13 }}>
            {t("settings.thumbCacheUsage", { used: formatBytes(cacheBytes), cap: formatBytes(capBytes) })}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 13, marginTop: 10, marginBottom: 6 }}>{t("settings.thumbCacheCap")}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {CAP_CHOICES_GB.map((gb) => {
              const bytes = gb * 1024 * 1024 * 1024;
              const active = capBytes === bytes;
              return (
                <Pressable
                  key={gb}
                  testID={`cap-${gb}`}
                  onPress={() => setCap(bytes)}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: active ? theme.brand : theme.border, backgroundColor: active ? theme.brand : "transparent" }}
                >
                  <Text style={{ color: active ? "#fff" : theme.text }}>{gb} GB</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable testID="clear-cache" onPress={clearCache} style={{ marginTop: 12 }}>
            <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("settings.clearCache")}</Text>
          </Pressable>
        </Section>

        {/* Backup rules */}
        <Section title={t("backup.title")} theme={theme}>
          <ToggleRow
            testID="toggle-wifi"
            label={t("settings.wifiOnly")}
            value={backup.wifiOnly}
            onChange={(v) => setBackupConfig(db, { wifiOnly: v })}
            theme={theme}
          />
          <ToggleRow
            testID="toggle-charging"
            label={t("settings.chargingOnly")}
            value={backup.chargingOnly}
            onChange={(v) => setBackupConfig(db, { chargingOnly: v })}
            theme={theme}
          />
        </Section>

        {/* Memories reminder */}
        <Section title={t("memories.title")} theme={theme}>
          <ToggleRow
            testID="toggle-memories-notif"
            label={t("memories.enableNotification")}
            value={memoriesNotif.enabled}
            onChange={(v) => void toggleMemoriesNotif(v)}
            theme={theme}
          />
          {memoriesNotif.enabled ? (
            <Pressable
              testID="memories-notif-time"
              onPress={() => setEditingTime(true)}
              style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 }}
            >
              <Text style={{ color: theme.text }}>{t("memories.notificationTime")}</Text>
              <Text style={{ color: theme.muted }}>{formatTime(memoriesNotif.hour, memoriesNotif.minute)} ›</Text>
            </Pressable>
          ) : null}
        </Section>

        {/* Server preferences (online) */}
        <Section title={t("settings.server")} theme={theme}>
          {!isOnline ? <Text style={{ color: theme.muted, fontSize: 12, marginBottom: 8 }}>{t("settings.savingOffline")}</Text> : null}
          <Text style={{ color: theme.muted, fontSize: 13 }}>{t("settings.favoriteMinRating")}</Text>
          <Text style={{ color: theme.muted, fontSize: 11, marginBottom: 6 }}>{t("settings.favoriteMinRatingHint")}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((r) => {
              const active = favoriteMinRating === r;
              return (
                <Pressable
                  key={r}
                  testID={`fav-rating-${r}`}
                  disabled={!isOnline || ratingBusy}
                  onPress={() => void setFavoriteMinRating(r)}
                  style={{ width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: active ? theme.brand : theme.border, backgroundColor: active ? theme.brand : "transparent", opacity: isOnline ? 1 : 0.5 }}
                >
                  <Text style={{ color: active ? "#fff" : theme.text, fontWeight: "700" }}>{r}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable testID="settings-scan" disabled={!isOnline} onPress={() => void scan()} style={{ marginTop: 16, opacity: isOnline ? 1 : 0.5 }}>
            <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("settings.scanNow")}</Text>
          </Pressable>
        </Section>

        {/* Account (online) */}
        <Section title={t("profile.settings")} theme={theme}>
          <Pressable testID="change-password" disabled={!isOnline} onPress={() => setChangingPassword(true)} style={{ paddingVertical: 8, opacity: isOnline ? 1 : 0.5 }}>
            <Text style={{ color: theme.text }}>{t("profile.changePassword")}</Text>
          </Pressable>
        </Section>
      </ScrollView>

      <TextPromptModal
        visible={changingPassword}
        title={t("profile.newPassword")}
        placeholder={t("profile.newPassword")}
        submitLabel={t("common.save")}
        testID="password-prompt"
        onSubmit={(value) => void changePassword(value)}
        onCancel={() => setChangingPassword(false)}
      />

      <TextPromptModal
        visible={editingTime}
        title={t("memories.notificationTime")}
        placeholder="09:00"
        initialValue={formatTime(memoriesNotif.hour, memoriesNotif.minute)}
        submitLabel={t("common.save")}
        testID="reminder-time-prompt"
        onSubmit={(value) => void setReminderTime(value)}
        onCancel={() => setEditingTime(false)}
      />
    </SafeAreaView>
  );
}

function Section({ title, theme, children }: { title: string; theme: ThemeColors; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16 }}>
      <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15, marginBottom: 10 }}>{title}</Text>
      {children}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  theme,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  theme: ThemeColors;
  testID: string;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 }}>
      <Text style={{ color: theme.text }}>{label}</Text>
      <Switch testID={testID} value={value} onValueChange={onChange} />
    </View>
  );
}
