'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, registerAuthCallbacks, setTokens } from '@/lib/api';

interface AuthState {
  hasHydrated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  phone: string | null;
  user: { id: string; phone: string; role: string } | null;
  requestOtp: (phone: string) => Promise<{ devCode?: string }>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      accessToken: null,
      refreshToken: null,
      phone: null,
      user: null,
      requestOtp: async (phone) => {
        const result = await api.otpRequest(phone);
        return { devCode: result.devCode };
      },
      verifyOtp: async (phone, code) => {
        const result = await api.otpVerify(phone, code, 'Homental Web');
        setTokens(result.accessToken, result.refreshToken);
        set({ accessToken: result.accessToken, refreshToken: result.refreshToken, phone, user: result.user });
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
      name: 'homental-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        phone: state.phone,
        user: state.user,
      }),
      onRehydrateStorage: () => (state) => {
        setTokens(state?.accessToken ?? null, state?.refreshToken ?? null);
        useAuthStore.setState({ hasHydrated: true });
      },
    },
  ),
);

registerAuthCallbacks({
  onTokensRefreshed: (accessToken, refreshToken) => {
    useAuthStore.setState({ accessToken, refreshToken });
  },
  onAuthCleared: () => {
    useAuthStore.setState({ accessToken: null, refreshToken: null, phone: null, user: null });
  },
});
