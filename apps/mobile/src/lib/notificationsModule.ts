import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

type NotificationsModule = typeof import("expo-notifications");

/**
 * Expo Go on Android dropped expo-notifications in SDK 53: importing the
 * module there throws, and a top-level import took every route down with it
 * (blank app on the Android emulator). iOS Expo Go and dev builds are fine.
 */
export function notificationsSupported(
  os: string = Platform.OS,
  environment: string | undefined = Constants.executionEnvironment
): boolean {
  return !(os === "android" && environment === ExecutionEnvironment.StoreClient);
}

/** expo-notifications, loaded on first use; null where the runtime lacks it. */
export async function loadNotifications(): Promise<NotificationsModule | null> {
  if (!notificationsSupported()) return null;
  return import("expo-notifications");
}
