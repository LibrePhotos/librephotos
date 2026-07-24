import "@/global.css";
import "@/i18n";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { AppProviders } from "@/providers/AppProviders";
import { useAuthStore } from "@/stores/auth";
import { useResolvedScheme, useTheme } from "@/theme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProviders>
        <RootNavigator />
      </AppProviders>
    </GestureHandlerRootView>
  );
}

/**
 * Auth-gated navigator. `Stack.Protected` guards mount the tabs only when
 * authenticated and the login screen only when not — expo-router handles the
 * redirect. Status starts "unknown" while we hydrate tokens from secure-store.
 */
function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const scheme = useResolvedScheme();
  const theme = useTheme();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === "unknown") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  const isAuthed = status === "authenticated";

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={isAuthed}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="photo/[id]" options={{ presentation: "modal" }} />
          <Stack.Screen name="sharing" />
        </Stack.Protected>
        <Stack.Protected guard={!isAuthed}>
          <Stack.Screen name="(auth)/login" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
