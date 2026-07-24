import * as SecureStore from "expo-secure-store";
import type { TokenSupplier } from "@librephotos/api-client";

/**
 * JWT storage backed by expo-secure-store (Keychain / Keystore), NOT
 * AsyncStorage — tokens are secrets. Implements the api-client TokenSupplier so
 * the transport can read/refresh/clear tokens without knowing about Expo.
 */
const ACCESS_KEY = "librephotos.access";
const REFRESH_KEY = "librephotos.refresh";

export const tokenStorage: TokenSupplier & {
  setTokens(access: string, refresh: string): Promise<void>;
} = {
  getAccessToken: () => SecureStore.getItemAsync(ACCESS_KEY),
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_KEY),
  async setAccessToken(token: string) {
    await SecureStore.setItemAsync(ACCESS_KEY, token);
  },
  async setTokens(access: string, refresh: string) {
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  },
  async clearTokens() {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};
