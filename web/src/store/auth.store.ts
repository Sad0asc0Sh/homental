'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, onAuthCleared, setTokens } from '@/lib/api';

interface AuthState {
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
        if (state?.accessToken || state?.refreshToken) {
          setTokens(state.accessToken, state.refreshToken);
        }
        // Automatic token refresh rotation: when api.ts clears auth after a
        // failed refresh, this resets the persisted zustand state cleanly.
        onAuthCleared(() => {
          useAuthStore.setState({ accessToken: null, refreshToken: null, phone: null, user: null });
        });
      },
    },
  ),
);
