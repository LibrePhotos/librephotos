import * as SecureStore from "expo-secure-store";
import type { TokenSupplier } from "@librephotos/api-client";

/**
 * JWT storage backed by expo-secure-store (Keychain / Keystore), NOT
 * AsyncStorage — tokens are secrets. Implements the api-client TokenSupplier so
 * the transport can read/refresh/clear tokens without knowing about Expo.
 */
const ACCESS_KEY = "librephotos.access";
const REFRESH_KEY = "librephotos.refresh";
const SERVER_KEY = "librephotos.serverUrl";

/**
 * The server URL is persisted next to the tokens because the two only mean
 * anything together: a token identifies you *to a particular server*. Keeping
 * the URL in memory only meant that after a reload the app restored its tokens,
 * considered itself signed in, and then issued every request against an empty
 * base URL — which resolves relative to the Metro dev server in Expo Go and
 * comes back as a stream of HTTP 500s that never reach LibrePhotos at all.
 */
export const serverStorage = {
  get: () => SecureStore.getItemAsync(SERVER_KEY),
  async set(url: string) {
    await SecureStore.setItemAsync(SERVER_KEY, url);
  },
  async clear() {
    await SecureStore.deleteItemAsync(SERVER_KEY);
  },
};

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
