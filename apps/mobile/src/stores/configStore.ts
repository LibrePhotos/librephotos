import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { FileLogger } from 'react-native-file-logger'

type ConfigState = {
  baseurl: string
  logging: boolean
}

type ConfigActions = {
  changeBaseurl: (payload: { baseurl: string }) => void
  configureLogging: (payload: { logging: boolean }) => void
}

export const useConfigStore = create<ConfigState & ConfigActions>()(
  persist(
    set => ({
      baseurl: 'http://192.168.0.107:3000',
      logging: true,
      changeBaseurl: ({ baseurl }) => {
        if (typeof baseurl !== 'undefined') {
          set({ baseurl })
        }
      },
      configureLogging: ({ logging }) => {
        if (typeof logging !== 'undefined') {
          set({ logging })
          if (logging === false) {
            FileLogger.debug('Logging: Enabled')
          } else {
            FileLogger.debug('Logging: Disabled')
            FileLogger.deleteLogFiles()
          }
        }
      },
    }),
    {
      name: 'config-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
)
