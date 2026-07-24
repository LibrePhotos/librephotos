import { Text, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme";

/** Bottom tabs: Photos, Albums, Search, Backup, Profile (matches doc 01). */
export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  const icon = (glyph: string) =>
    function TabIcon({ color }: { color: ColorValue }) {
      return <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;
    };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: { backgroundColor: theme.background, borderTopColor: theme.border },
      }}
    >
      <Tabs.Screen name="photos" options={{ title: t("tabs.photos"), tabBarIcon: icon("▦") }} />
      <Tabs.Screen name="albums" options={{ title: t("tabs.albums"), tabBarIcon: icon("▧") }} />
      <Tabs.Screen name="search" options={{ title: t("tabs.search"), tabBarIcon: icon("⌕") }} />
      <Tabs.Screen name="backup" options={{ title: t("tabs.backup"), tabBarIcon: icon("↑") }} />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile"), tabBarIcon: icon("☺") }} />
    </Tabs>
  );
}
