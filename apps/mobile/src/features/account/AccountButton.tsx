import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { mediaHeaders, useUserSelfDetailsQuery } from "@librephotos/api-client";
import { useBackupState } from "@/features/backup/backupStatus";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useAuthStore } from "@/stores/auth";
import { useTheme, type ThemeColors } from "@/theme";
import { backupRing, type BackupRing } from "./backupRing";

const SIZE = 40;
const STROKE = 3;
const AVATAR = SIZE - STROKE * 2 - 4;

function ringColor(ring: BackupRing, theme: ThemeColors): string {
  switch (ring.tone) {
    case "done":
      return "#16a34a";
    case "error":
      return "#dc2626";
    case "paused":
      return theme.muted;
    default:
      return theme.brand;
  }
}

/** Absolute server URL for a server-relative avatar path. */
export function avatarSource(base: string, avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (/^https?:\/\//.test(avatarUrl)) return avatarUrl;
  return `${base.replace(/\/$/, "")}/${avatarUrl.replace(/^\//, "")}`;
}

/**
 * The account avatar that floats over the main screens. The ring around it
 * shows backup at a glance; a tap opens the account screen (backup, library,
 * settings, logout), which replaces the old Backup and Profile tabs.
 */
export function AccountButton() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const user = useUserSelfDetailsQuery(userId ?? undefined);
  const token = useAccessToken();
  const headers = useMemo(() => mediaHeaders(token), [token]);
  const ring = backupRing(useBackupState());
  const source = avatarSource(serverAddress(), user.data?.avatar_url);
  const name = user.data ? user.data.first_name || user.data.username : "";
  const initial = name.slice(0, 1).toUpperCase();

  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = ringColor(ring, theme);

  return (
    <Pressable
      testID="account-button"
      accessibilityRole="button"
      accessibilityLabel={t("account.open")}
      onPress={() => router.push("/profile")}
      hitSlop={8}
      style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" }}
    >
      {ring.tone !== "off" ? (
        <Svg width={SIZE} height={SIZE} style={{ position: "absolute" }} testID={`account-ring-${ring.tone}`}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={radius} stroke={theme.border} strokeWidth={STROKE} fill="none" />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={radius}
            stroke={color}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - ring.progress)}
            // Start the arc at 12 o'clock.
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
      ) : null}
      <View
        style={{
          width: AVATAR,
          height: AVATAR,
          borderRadius: AVATAR / 2,
          overflow: "hidden",
          backgroundColor: theme.brand,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {source ? (
          <Image source={{ uri: source, headers }} style={{ width: AVATAR, height: AVATAR }} contentFit="cover" />
        ) : (
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{initial}</Text>
        )}
      </View>
    </Pressable>
  );
}
