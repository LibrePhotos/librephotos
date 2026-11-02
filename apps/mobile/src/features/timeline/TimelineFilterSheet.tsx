import { useState } from "react";
import { Modal, Pressable, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { endpoints, useApiClient, userKeys } from "@librephotos/api-client";
import { NO_TIMELINE_FILTER, type TimelineFilter } from "@/db/queries/timeline";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/toasts";
import { useTheme, type ThemeColors } from "@/theme";
import { sameFilter, toServerDefault } from "./timelineFilter";

const MEDIA: readonly TimelineFilter["media"][] = ["all", "photos", "videos"];

/**
 * The timeline filter, as a sheet from the bottom: what to show (all, photos,
 * videos), favorites only, and whether to hide screenshots and documents. It
 * applies at once and works offline; "Save as default" stores it on the user,
 * the same default the web timeline uses.
 */
export function TimelineFilterSheet({
  visible,
  filter,
  savedDefault,
  onChange,
  onClose,
}: {
  visible: boolean;
  filter: TimelineFilter;
  savedDefault: TimelineFilter;
  onChange: (filter: TimelineFilter) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.userId);
  const online = useOnlineStatus();
  const pushToast = useToastStore((s) => s.push);
  const [saving, setSaving] = useState(false);
  const isDefault = sameFilter(filter, savedDefault);

  const saveDefault = async () => {
    if (userId == null) return;
    setSaving(true);
    try {
      const user = await endpoints.updateUserPartial(client, userId, {
        default_timeline_filter: toServerDefault(filter),
      });
      queryClient.setQueryData(userKeys.selfDetail(userId), user);
      pushToast({ level: "info", message: t("timelineFilter.saved") });
    } catch {
      pushToast({ level: "error", message: t("settings.saveError") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable testID="timeline-filter-backdrop" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} />
      <View
        testID="timeline-filter-sheet"
        style={{
          backgroundColor: theme.background,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: 20,
          paddingTop: 10,
          paddingBottom: insets.bottom + 16,
          gap: 14,
        }}
      >
        <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border }} />
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>{t("timelineFilter.title")}</Text>

        <View style={{ flexDirection: "row", backgroundColor: theme.card, borderRadius: 12, padding: 4 }}>
          {MEDIA.map((media) => {
            const active = filter.media === media;
            return (
              <Pressable
                key={media}
                testID={`timeline-filter-media-${media}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onChange({ ...filter, media })}
                style={{ flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center", backgroundColor: active ? theme.background : "transparent" }}
              >
                <Text style={{ color: active ? theme.text : theme.muted, fontWeight: active ? "700" : "500" }}>
                  {t(`timelineFilter.media.${media}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Toggle
          testID="timeline-filter-favorites"
          label={t("timelineFilter.favorites")}
          value={filter.favorites}
          onChange={(favorites) => onChange({ ...filter, favorites })}
          theme={theme}
        />
        <Toggle
          testID="timeline-filter-screenshots"
          label={t("timelineFilter.hideScreenshots")}
          value={filter.hideScreenshots}
          onChange={(hideScreenshots) => onChange({ ...filter, hideScreenshots })}
          theme={theme}
        />
        <Toggle
          testID="timeline-filter-documents"
          label={t("timelineFilter.hideDocuments")}
          value={filter.hideDocuments}
          onChange={(hideDocuments) => onChange({ ...filter, hideDocuments })}
          theme={theme}
        />

        <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
          <Pressable
            testID="timeline-filter-reset"
            onPress={() => onChange(NO_TIMELINE_FILTER)}
            style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", backgroundColor: theme.card }}
          >
            <Text style={{ color: theme.text, fontWeight: "600" }}>{t("timelineFilter.reset")}</Text>
          </Pressable>
          <Pressable
            testID="timeline-filter-save-default"
            onPress={() => void saveDefault()}
            disabled={isDefault || saving || !online}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
              backgroundColor: isDefault || !online ? theme.card : theme.brand,
            }}
          >
            <Text style={{ color: isDefault || !online ? theme.muted : "#fff", fontWeight: "600" }}>
              {isDefault ? t("timelineFilter.isDefault") : t("timelineFilter.saveDefault")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Toggle({
  label,
  value,
  onChange,
  theme,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  theme: ThemeColors;
  testID: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ color: theme.text, fontSize: 15 }}>{label}</Text>
      <Switch testID={testID} value={value} onValueChange={onChange} trackColor={{ true: theme.brand }} />
    </View>
  );
}
