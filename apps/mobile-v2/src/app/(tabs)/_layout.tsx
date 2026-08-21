import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme";

/**
 * Bottom tabs: Photos, Albums, Search, Backup, Profile (matches doc 01).
 *
 * Two device-run bugs are fixed here and are easy to reintroduce:
 *
 *  1. Icons were bare Unicode glyphs (`▦ ▧ ⌕ ↑ ☺`) in a `<Text>`. iOS's system
 *     font has no glyph for most of them, so they rendered as blank space on a
 *     real iPhone (they look fine in a desktop editor). Icons must come from a
 *     real icon font — `@expo/vector-icons` is bundled inside Expo Go, so it
 *     adds no native code and works without a dev build.
 *  2. `<Tabs.Screen name>` must match the *route* name, not the URL. A folder
 *     with only an `index.tsx` and no `_layout.tsx` registers as `search/index`,
 *     so `name="search"` matched nothing and those two tabs silently rendered
 *     with default options — no icon and no label. Every tab folder here has a
 *     `_layout.tsx`; keep it that way when adding one.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: { backgroundColor: theme.background, borderTopColor: theme.border },
        // Five tabs on a 375pt-wide iPhone: shrink the label a touch and never
        // let it wrap, so "Backup"/"Profile" stay fully readable.
        tabBarLabelStyle: { fontSize: 10, marginBottom: 2 },
        tabBarLabelPosition: "below-icon",
        tabBarAllowFontScaling: false,
      }}
    >
      <Tabs.Screen
        name="photos"
        options={{
          title: t("tabs.photos"),
          tabBarLabel: t("tabs.photos"),
          tabBarIcon: tabIcon("images", "images-outline"),
        }}
      />
      <Tabs.Screen
        name="albums"
        options={{
          title: t("tabs.albums"),
          tabBarLabel: t("tabs.albums"),
          tabBarIcon: tabIcon("albums", "albums-outline"),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t("tabs.search"),
          tabBarLabel: t("tabs.search"),
          tabBarIcon: tabIcon("search", "search-outline"),
        }}
      />
      <Tabs.Screen
        name="backup"
        options={{
          title: t("tabs.backup"),
          tabBarLabel: t("tabs.backup"),
          tabBarIcon: tabIcon("cloud-upload", "cloud-upload-outline"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("tabs.profile"),
          tabBarLabel: t("tabs.profile"),
          tabBarIcon: tabIcon("person-circle", "person-circle-outline"),
        }}
      />
    </Tabs>
  );
}

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/**
 * Build a `tabBarIcon` renderer. expo-router hands it `{ color, size, focused }`
 * from the navigator, so the icon follows the active/inactive tint and switches
 * to the filled variant when selected.
 */
function tabIcon(active: IoniconName, inactive: IoniconName) {
  return function TabIcon({ color, size, focused }: { color: string; size: number; focused: boolean }) {
    return <Ionicons name={focused ? active : inactive} size={size ?? 24} color={color} />;
  };
}
