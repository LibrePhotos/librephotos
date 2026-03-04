import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

type ThemeState = {
  theme: string | null
  darkMode: boolean | null
}

type ThemeActions = {
  changeTheme: (payload: { darkMode?: boolean | null; theme?: string }) => void
  setDefaultTheme: (payload: { theme: string; darkMode: boolean | null }) => void
}

export const useThemeStore = create<ThemeState & ThemeActions>()(
  persist(
    (set, get) => ({
      theme: null,
      darkMode: null,
      changeTheme: ({ darkMode, theme }) =>
        set(state => ({
          ...(typeof theme !== 'undefined' ? { theme } : {}),
          ...(typeof darkMode !== 'undefined' ? { darkMode } : {}),
        })),
      setDefaultTheme: ({ theme, darkMode }) => {
        if (!get().theme) {
          set({ theme, darkMode })
        }
      },
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
)
