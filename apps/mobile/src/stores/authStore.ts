import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { jwtDecode } from 'jwt-decode'
import type { IToken, IAuthError } from './types/auth.zod'

type AuthState = {
  access: (IToken & { token: string }) | null
  refresh: (IToken & { token: string }) | null
  error: IAuthError | null
}

type AuthActions = {
  tokenReceived: (payload: { access: string }) => void
  setTokens: (payload: { access: string; refresh: string }) => void
  logout: () => void
  clearError: () => void
}

const initialState: AuthState = {
  access: null,
  refresh: null,
  error: null,
}

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    set => ({
      ...initialState,
      tokenReceived: ({ access }) =>
        set(state => ({
          ...state,
          access: {
            ...jwtDecode<IToken>(access),
            token: access,
          },
        })),
      setTokens: ({ access, refresh }) =>
        set({
          access: {
            ...jwtDecode<IToken>(access),
            token: access,
          },
          refresh: {
            ...jwtDecode<IToken>(refresh),
            token: refresh,
          },
          error: null,
        }),
      logout: () => set(initialState),
      clearError: () => set(state => ({ ...state, error: null })),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
)

export const useAuthToken = () => useAuthStore(s => s.access?.token ?? null)
