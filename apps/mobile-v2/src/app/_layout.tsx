import "@/global.css";
import "@/i18n";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { AppProviders } from "@/providers/AppProviders";
import { DatabaseGate } from "@/db/DatabaseGate";
import { SeedOnLogin } from "@/sync/SeedOnLogin";
import { AppChrome } from "@/components/AppChrome";
import { NotificationRouter } from "@/features/memories/NotificationRouter";
import { noteInteraction } from "@/sync/activity";
import { useAuthStore } from "@/stores/auth";
import { useResolvedScheme, useTheme } from "@/theme";

/**
 * Capture-phase touch sniffer. Returning false declines the responder, so the
 * touch reaches whatever it was aimed at untouched — this only observes. It
 * covers taps, tab switches and press-and-holds; the lists report their own
 * scrolls, which native ScrollViews do not surface here.
 */
function sniffTouch(): boolean {
  noteInteraction();
  return false;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={sniffTouch}
      onMoveShouldSetResponderCapture={sniffTouch}
    >
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

  // The mirror is opened + migrated once and provided to every route (so the
  // viewer modal, a sibling of the tabs, shares one DB). Live queries read from
  // it; the seeder runs after login.
  return (
    <DatabaseGate>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {isAuthed ? <SeedOnLogin /> : null}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={isAuthed}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="photo/[id]" options={{ presentation: "modal" }} />
          <Stack.Screen name="sharing" />
          <Stack.Screen name="memories" />
          <Stack.Screen name="share" options={{ presentation: "modal" }} />
        </Stack.Protected>
        <Stack.Protected guard={!isAuthed}>
          <Stack.Screen name="(auth)/login" />
        </Stack.Protected>
      </Stack>
      {isAuthed ? <AppChrome /> : null}
      {isAuthed ? <NotificationRouter /> : null}
    </DatabaseGate>
  );
}
