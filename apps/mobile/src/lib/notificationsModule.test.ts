import { ExecutionEnvironment } from "expo-constants";
import { notificationsSupported } from "./notificationsModule";

describe("notificationsSupported", () => {
  it("is false only in Expo Go on Android", () => {
    expect(notificationsSupported("android", ExecutionEnvironment.StoreClient)).toBe(false);
  });

  it("is true in Expo Go on iOS and in dev or release builds", () => {
    expect(notificationsSupported("ios", ExecutionEnvironment.StoreClient)).toBe(true);
    expect(notificationsSupported("android", ExecutionEnvironment.Bare)).toBe(true);
    expect(notificationsSupported("android", ExecutionEnvironment.Standalone)).toBe(true);
    expect(notificationsSupported("android", undefined)).toBe(true);
  });
});
