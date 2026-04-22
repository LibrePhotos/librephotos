import AsyncStorage from '@react-native-async-storage/async-storage'

const ACCESS_TOKEN_KEY = '@librephotos/access_token'
const REFRESH_TOKEN_KEY = '@librephotos/refresh_token'

export const tokenStorage = {
  async getAccessToken(): Promise<string | null> {
    return AsyncStorage.getItem(ACCESS_TOKEN_KEY)
  },

  async getRefreshToken(): Promise<string | null> {
    return AsyncStorage.getItem(REFRESH_TOKEN_KEY)
  },

  async setTokens(access: string, refresh: string): Promise<void> {
    await AsyncStorage.multiSet([
      [ACCESS_TOKEN_KEY, access],
      [REFRESH_TOKEN_KEY, refresh],
    ])
  },

  async setAccessToken(access: string): Promise<void> {
    await AsyncStorage.setItem(ACCESS_TOKEN_KEY, access)
  },

  async clearTokens(): Promise<void> {
    await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY])
  },
}
