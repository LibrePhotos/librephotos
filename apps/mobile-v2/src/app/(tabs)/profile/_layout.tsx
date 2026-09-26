import { Stack } from "expo-router";

/** Profile tab stack: the hub (index) plus the Sync status screen. */
export default function ProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
