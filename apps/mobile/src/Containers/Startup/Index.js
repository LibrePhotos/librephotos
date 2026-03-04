import React, { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Text } from 'native-base'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/Theme'
import { Brand } from '@/Components'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'
import { useLocalImagesStore } from '@/stores/localImagesStore'
import { tokenStorage } from '@/api_client/platform/tokenStorage'
import { navigateAndSimpleReset } from '@/Navigators/Root'

/**
 * One-time migration from old Redux persist data to Zustand stores.
 * Redux persist stored everything under 'persist:root' with each slice
 * as a JSON-stringified sub-key. Zustand uses separate AsyncStorage keys.
 */
async function migrateFromReduxPersist() {
  const migrationKey = '@librephotos/zustand_migrated'
  const alreadyMigrated = await AsyncStorage.getItem(migrationKey)
  if (alreadyMigrated) {
    console.log('[Migration] Already migrated from Redux persist')
    return
  }

  const raw = await AsyncStorage.getItem('persist:root')
  if (!raw) {
    console.log('[Migration] No Redux persist data found, skipping')
    await AsyncStorage.setItem(migrationKey, '1')
    return
  }

  console.log('[Migration] Found Redux persist data, migrating...')
  try {
    const root = JSON.parse(raw)

    // Migrate config
    if (root.config) {
      const config = JSON.parse(root.config)
      console.log('[Migration] Config:', JSON.stringify(config))
      if (config.baseurl) {
        useConfigStore.getState().changeBaseurl({ baseurl: config.baseurl })
      }
      if (typeof config.logging === 'boolean') {
        useConfigStore.getState().configureLogging({ logging: config.logging })
      }
    }

    // Migrate auth
    if (root.auth) {
      const auth = JSON.parse(root.auth)
      console.log('[Migration] Auth access present:', !!auth.access)
      if (auth.access?.token && auth.refresh?.token) {
        useAuthStore.getState().setTokens({
          access: auth.access.token,
          refresh: auth.refresh.token,
        })
        // Also write to tokenStorage so fetchClient can use them
        await tokenStorage.setTokens(auth.access.token, auth.refresh.token)
      }
    }

    // Migrate theme
    if (root.theme) {
      const theme = JSON.parse(root.theme)
      console.log('[Migration] Theme:', JSON.stringify(theme))
      useThemeStore.getState().changeTheme({
        theme: theme.theme,
        darkMode: theme.darkMode,
      })
    }

    // Migrate localImages
    if (root.localImages) {
      const localImages = JSON.parse(root.localImages)
      console.log(
        '[Migration] LocalImages count:',
        localImages.images?.length ?? 0,
      )
      if (localImages.images?.length > 0) {
        useLocalImagesStore.getState().addImages(localImages.images)
      }
    }

    console.log('[Migration] Migration complete')
  } catch (err) {
    console.log('[Migration] Error during migration:', err)
  }

  await AsyncStorage.setItem(migrationKey, '1')
}

const IndexStartupContainer = () => {
  const { Colors, Layout, Gutters, Fonts } = useTheme()
  const { t } = useTranslation()

  useEffect(() => {
    const init = async () => {
      console.log('[Startup] init')

      // Migrate old Redux persist data if needed
      await migrateFromReduxPersist()

      // Set default theme if not already set + wait for splash
      useThemeStore.getState().setDefaultTheme({ theme: 'default', darkMode: null })
      await new Promise(resolve => setTimeout(resolve, 500))

      // Debug: log store state after hydration
      const authState = useAuthStore.getState()
      const configState = useConfigStore.getState()
      console.log('[Startup] Auth token present:', !!authState.access?.token)
      console.log('[Startup] Config baseurl:', configState.baseurl)
      console.log('[Startup] Theme:', JSON.stringify({
        theme: useThemeStore.getState().theme,
        darkMode: useThemeStore.getState().darkMode,
      }))

      // Check if we have a stored token
      const accessToken = await tokenStorage.getAccessToken()
      console.log('[Startup] tokenStorage accessToken present:', !!accessToken)

      if (accessToken) {
        // Also ensure the Zustand auth store has the token
        // (in case hydration from persist hasn't happened yet)
        if (!authState.access?.token) {
          console.log('[Startup] Auth store empty, populating from tokenStorage')
          useAuthStore.getState().tokenReceived({ access: accessToken })
        }

        // Refresh the token to ensure the backend's jwt cookie is set.
        // The /media/ endpoints require this cookie for image auth.
        const refreshToken = await tokenStorage.getRefreshToken()
        if (refreshToken) {
          try {
            const baseurl = configState.baseurl
            const resp = await fetch(`${baseurl}/api/auth/token/refresh/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh: refreshToken }),
            })
            if (resp.ok) {
              const data = await resp.json()
              await tokenStorage.setAccessToken(data.access)
              useAuthStore.getState().tokenReceived({ access: data.access })
              console.log('[Startup] Token refreshed, jwt cookie set')
            } else {
              console.log('[Startup] Token refresh failed, redirecting to login')
              await tokenStorage.clearTokens()
              useAuthStore.getState().logout()
              navigateAndSimpleReset('Login')
              return
            }
          } catch (err) {
            console.log('[Startup] Token refresh error:', err)
          }
        }

        navigateAndSimpleReset('Main')
      } else {
        navigateAndSimpleReset('Login')
      }
    }
    init()
  }, [])

  return (
    <View style={[Layout.fill, Layout.colCenter]}>
      <Brand />
      <ActivityIndicator size={'large'} style={[Gutters.largeVMargin]} />
      <Text color={Colors.text} style={Fonts.textCenter}>
        {t('welcome')}
      </Text>
    </View>
  )
}

export default IndexStartupContainer
