import { Stack } from "expo-router";

/**
 * The account stack, opened from the avatar: the hub (index), then backup,
 * settings, faces, server and sync status pushed inside the sheet.
 */
export default function ProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
