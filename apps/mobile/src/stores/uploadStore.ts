import { create } from 'zustand'

type UploadState = {
  total: number
  current: number
  isUploading: boolean
}

type UploadActions = {
  setTotal: (total: number) => void
  setCurrent: (current: number) => void
  setUploading: (uploading: boolean) => void
  reset: () => void
}

const initialState: UploadState = {
  total: 1,
  current: 1,
  isUploading: false,
}

export const useUploadStore = create<UploadState & UploadActions>()(set => ({
  ...initialState,
  setTotal: (total: number) => set({ total }),
  setCurrent: (current: number) => set({ current }),
  setUploading: (uploading: boolean) => set({ isUploading: uploading }),
  reset: () => {
    console.log('Resetting upload')
    set(initialState)
  },
}))
