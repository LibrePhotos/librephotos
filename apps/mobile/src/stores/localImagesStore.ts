import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  LocalImage,
  LocalImages,
  SyncStatus,
} from './types/localImages.zod'

type LocalImagesState = {
  images: LocalImages
  lastFetch: number | undefined
  isLoading: boolean
}

type LocalImagesActions = {
  setLoading: (loading: boolean) => void
  addImages: (images: LocalImages) => void
  markSynced: (image: LocalImage) => void
  markNotSynced: (image: LocalImage) => void
  removeImages: (deletedImages: LocalImage[]) => void
  reset: () => void
}

const initialState: LocalImagesState = {
  images: [],
  lastFetch: undefined,
  isLoading: false,
}

export const useLocalImagesStore = create<LocalImagesState & LocalImagesActions>()(
  persist(
    set => ({
      ...initialState,
      setLoading: (loading: boolean) => set({ isLoading: loading }),
      addImages: (newImages: LocalImages) =>
        set(state => ({
          images: [...state.images, ...newImages],
          lastFetch:
            newImages.length > 0
              ? Math.floor(Date.now() / 1000)
              : state.lastFetch,
          isLoading: false,
        })),
      markSynced: (image: LocalImage) =>
        set(state => ({
          images: state.images.map(i =>
            i.id === image.id ? { ...i, syncStatus: SyncStatus.SYNCED } : i,
          ),
        })),
      markNotSynced: (image: LocalImage) =>
        set(state => {
          const existing = state.images.find(i => i.id === image.id)
          if (existing?.syncStatus === SyncStatus.LOCAL) {
            return state
          }
          return {
            images: state.images.map(i =>
              i.id === image.id ? { ...i, syncStatus: SyncStatus.LOCAL } : i,
            ),
          }
        }),
      removeImages: (deletedImages: LocalImage[]) =>
        set(state => ({
          images: state.images.filter(
            i => !deletedImages.some(d => d.id === i.id),
          ),
        })),
      reset: () => {
        console.log('Resetting local images')
        set(initialState)
      },
    }),
    {
      name: 'localImages-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
)
