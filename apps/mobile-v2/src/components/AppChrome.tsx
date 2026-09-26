import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToastStore } from "@/stores/toasts";
import { useTheme } from "@/theme";

/**
 * App-wide chrome overlay (renders above every authed screen): the offline
 * indicator (expo-network) and the transient toast host that surfaces dropped
 * outbox mutations. Non-interactive except for tap-to-dismiss toasts, so it never
 * blocks the UI beneath it.
 */
export function AppChrome() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnlineStatus();
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top, left: 0, right: 0 }}>
      {!online ? (
        <View
          testID="offline-banner"
          style={{ backgroundColor: "#b45309", paddingVertical: 6, paddingHorizontal: 12 }}
        >
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600", textAlign: "center" }}>
            {t("offline.banner")}
          </Text>
        </View>
      ) : null}

      <View pointerEvents="box-none" style={{ paddingHorizontal: 12, gap: 6, marginTop: 6 }}>
        {toasts.map((toast) => (
          <ToastRow key={toast.id} id={toast.id} message={toast.message} level={toast.level} onDismiss={dismiss} theme={theme} />
        ))}
      </View>
    </View>
  );
}

function ToastRow({
  id,
  message,
  level,
  onDismiss,
  theme,
}: {
  id: number;
  message: string;
  level: "error" | "info";
  onDismiss: (id: number) => void;
  theme: ReturnType<typeof useTheme>;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 4500);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <Pressable
      testID={`toast-${id}`}
      onPress={() => onDismiss(id)}
      style={{
        backgroundColor: level === "error" ? "#dc2626" : theme.card,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: "#fff", fontSize: 13 }} numberOfLines={2}>
        {message}
      </Text>
    </Pressable>
  );
}
