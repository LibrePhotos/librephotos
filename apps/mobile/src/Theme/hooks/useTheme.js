import { useColorScheme } from 'react-native'
import { useThemeStore } from '@/stores/themeStore'
import { DarkTheme, DefaultTheme } from '@react-navigation/native'
import Fonts from '@/Theme/Fonts'
import Gutters from '@/Theme/Gutters'
import Images from '@/Theme/Images'
import Layout from '@/Theme/Layout'
import Common from '@/Theme/Common'
import * as DefaultVariables from '@/Theme/Variables'
import themes from '@/Theme/themes'

export default function () {
  // Get the scheme device
  const colorScheme = useColorScheme()

  // Get current theme from the store
  const currentTheme = useThemeStore(s => s.theme) || 'default'
  const isDark = useThemeStore(s => s.darkMode)
  const darkMode = isDark === null ? colorScheme === 'dark' : isDark
  //Select the right theme light theme ({} if not exist)
  const { Variables: themeConfigVars = {}, ...themeConfig } =
    themes[currentTheme] || {}

  const { Variables: darkThemeConfigVars = {}, ...darkThemeConfig } = darkMode
    ? themes[`${currentTheme}_dark`] || {}
    : {}

  const themeVariables = mergeVariables(
    DefaultVariables,
    themeConfigVars,
    darkThemeConfigVars,
  )

  // Build the default theme
  const baseTheme = {
    Fonts: Fonts(themeVariables),
    Gutters: Gutters(themeVariables),
    Images: Images(themeVariables),
    Layout: Layout(themeVariables),
    Common: Common({
      ...themeVariables,
      Layout: Layout(themeVariables),
      Gutters: Gutters(themeVariables),
    }),
    ...themeVariables,
  }

  // Merge and return the current Theme
  return buildTheme(
    darkMode,
    baseTheme,
    formatTheme(themeVariables, themeConfig || {}),
    formatTheme(themeVariables, darkThemeConfig || {}),
  )
}

/**
 * Generate Theme with theme variables
 */
const formatTheme = (variables, theme) => {
  return Object.entries(theme).reduce((acc, [name, generate]) => {
    return {
      ...acc,
      [name]: generate(variables),
    }
  }, {})
}

/**
 * Merge all variables for building the theme
 */
const mergeVariables = (variables, themeConfig, darkThemeConfig) =>
  Object.entries(variables).reduce((acc, [group, vars]) => {
    return {
      ...acc,
      [group]: {
        ...vars,
        ...(themeConfig[group] || {}),
        ...(darkThemeConfig[group] || {}),
      },
    }
  }, {})

/**
 * Provide all the theme exposed with useTheme()
 */
const buildTheme = (darkMode, baseTheme, themeConfig, darkThemeConfig) => {
  return {
    ...mergeTheme(baseTheme, themeConfig, darkThemeConfig),
    darkMode,
    NavigationTheme: mergeNavigationTheme(
      darkMode ? DarkTheme : DefaultTheme,
      baseTheme.NavigationColors,
    ),
  }
}

/**
 * Merge theme from baseTheme <- currentTheme <- currentDarkTheme
 */
const mergeTheme = (baseTheme, theme, darkTheme) => ({
  ...Object.entries(baseTheme).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [key]: {
        ...value,
        ...(theme[key] || {}),
        ...(darkTheme[key] || {}),
      },
    }),
    {},
  ),
})

/**
 * Merge the React Navigation Theme
 */
const mergeNavigationTheme = (reactNavigationTheme, overrideColors) => ({
  ...reactNavigationTheme,
  colors: {
    ...reactNavigationTheme.colors,
    ...overrideColors,
  },
})
