import { Stack } from "expo-router";

/**
 * Backup tab stack. Present even though the tab has a single screen: without a
 * `_layout.tsx` the folder registers in the tab navigator as `backup/index`,
 * and `<Tabs.Screen name="backup">` in `(tabs)/_layout.tsx` then matches
 * nothing — the tab loses its icon and its label.
 */
export default function BackupLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
