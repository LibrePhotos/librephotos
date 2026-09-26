import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useLoginMutation } from "@librephotos/api-client";
import { useAuthStore } from "@/stores/auth";
import { normalizeServerUrl, useSettingsStore } from "@/stores/settings";
import { useTheme } from "@/theme";

/**
 * Self-hosted login: the server URL comes FIRST (there is no default server).
 * We set the server URL in the settings store before firing the JWT obtain
 * request (the api-client reads baseUrl live from that store), then persist the
 * returned tokens to secure-store via the auth store.
 */
export function LoginScreen({ onSuccess }: { onSuccess?: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const onLoggedIn = useAuthStore((s) => s.onLoggedIn);

  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useLoginMutation();

  const canSubmit = server.trim().length > 0 && username.length > 0 && password.length > 0 && !login.isPending;

  async function handleSubmit() {
    setError(null);
    if (server.trim().length === 0) {
      setError(t("login.missingServer"));
      return;
    }
    // Must be set before the mutation runs — the transport reads it live.
    setServerUrl(normalizeServerUrl(server));
    try {
      const data = await login.mutateAsync({ username, password });
      await onLoggedIn(data.access, data.refresh);
      onSuccess?.();
    } catch {
      setError(t("login.failed"));
    }
  }

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    backgroundColor: theme.card,
  } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 14 }}>
        <Text testID="login-title" style={{ fontSize: 28, fontWeight: "700", color: theme.text, marginBottom: 8 }}>
          {t("login.title")}
        </Text>

        <Text style={{ color: theme.muted, fontSize: 13 }}>{t("login.serverUrl")}</Text>
        <TextInput
          testID="login-server"
          value={server}
          onChangeText={setServer}
          placeholder={t("login.serverUrlPlaceholder")}
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={inputStyle}
        />

        <Text style={{ color: theme.muted, fontSize: 13 }}>{t("login.username")}</Text>
        <TextInput
          testID="login-username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          style={inputStyle}
        />

        <Text style={{ color: theme.muted, fontSize: 13 }}>{t("login.password")}</Text>
        <TextInput
          testID="login-password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={inputStyle}
        />

        {error ? (
          <Text testID="login-error" style={{ color: "#dc2626" }}>
            {error}
          </Text>
        ) : null}

        <Pressable
          testID="login-submit"
          disabled={!canSubmit}
          onPress={handleSubmit}
          style={{
            backgroundColor: canSubmit ? theme.brand : theme.border,
            borderRadius: 10,
            paddingVertical: 14,
            alignItems: "center",
            marginTop: 8,
          }}
        >
          {login.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "600" }}>{t("login.submit")}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
