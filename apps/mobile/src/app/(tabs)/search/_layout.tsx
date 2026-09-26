import { Stack } from "expo-router";

/**
 * Search tab stack. Present even though the tab has a single screen: without a
 * `_layout.tsx` the folder registers in the tab navigator as `search/index`,
 * and `<Tabs.Screen name="search">` in `(tabs)/_layout.tsx` then matches
 * nothing — the tab loses its icon and its label.
 */
export default function SearchLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
