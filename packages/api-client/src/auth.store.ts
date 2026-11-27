'use client';

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, onAuthCleared, onTokensUpdated, setTokens } from './api';

export interface AuthUser {
  id: string;
  phone: string;
  role: string;
}

export interface AuthState {
  hasHydrated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  phone: string | null;
  user: AuthUser | null;
  setHasHydrated: () => void;
  requestOtp: (phone: string) => Promise<{ devCode?: string }>;
  verifyOtp: (phone: string, code: string) => Promise<AuthUser>;
  logout: () => void;
}

export interface AuthStoreOptions {
  storageKey: string;
  deviceInfo?: string;
}

export type AuthStore = UseBoundStore<StoreApi<AuthState>>;

/**
 * Creates a persisted Zustand auth store scoped to a dedicated storageKey
 * (e.g. `homental-customer-auth` vs `homental-partners-auth`) so customer and
 * partner sessions never overwrite each other across origins/apps.
 */
export function createAuthStore(options: AuthStoreOptions): AuthStore {
  const { storageKey, deviceInfo = 'Homental Web' } = options;

  const store = create<AuthState>()(
    persist(
      (set, get) => ({
        hasHydrated: false,
        accessToken: null,
        refreshToken: null,
        phone: null,
        user: null,
        setHasHydrated: () => set({ hasHydrated: true }),
        requestOtp: async (phone) => {
          const result = await api.otpRequest(phone);
          return { devCode: result.devCode };
        },
        verifyOtp: async (phone, code) => {
          const result = await api.otpVerify(phone, code, deviceInfo);
          setTokens(result.accessToken, result.refreshToken);
          set({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            phone,
            user: result.user,
          });
          return result.user;
        },
        logout: () => {
          const rt = get().refreshToken;
          if (rt && get().accessToken) {
            void api.logout(rt).catch(() => undefined);
          }
          setTokens(null, null);
          set({ accessToken: null, refreshToken: null, phone: null, user: null });
        },
      }),
      {
        name: storageKey,
        partialize: (state) => ({
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
          phone: state.phone,
          user: state.user,
        }),
        onRehydrateStorage: () => (state) => {
          setTokens(state?.accessToken ?? null, state?.refreshToken ?? null);
          // NOTE: in zustand v4 this callback may NOT fire when storage is
          // empty (first visit) — headers call setHasHydrated() on mount too.
          state?.setHasHydrated?.();
        },
      },
    ),
  );

  onTokensUpdated((accessToken, refreshToken) => {
    store.setState({ accessToken, refreshToken });
  });

  onAuthCleared(() => {
    store.setState({ accessToken: null, refreshToken: null, phone: null, user: null });
  });

  return store;
}
