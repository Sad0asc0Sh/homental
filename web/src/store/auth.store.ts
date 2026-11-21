'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, setAuthToken } from '@/lib/api';

interface AuthState {
  accessToken: string | null;
  phone: string | null;
  user: { id: string; phone: string; role: string } | null;
  requestOtp: (phone: string) => Promise<{ devCode?: string }>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      phone: null,
      user: null,
      requestOtp: async (phone) => {
        const result = await api.otpRequest(phone);
        return { devCode: result.devCode };
      },
      verifyOtp: async (phone, code) => {
        const result = await api.otpVerify(phone, code, 'Homental Web');
        setAuthToken(result.accessToken);
        set({ accessToken: result.accessToken, phone, user: result.user });
      },
      logout: () => {
        setAuthToken(null);
        set({ accessToken: null, phone: null, user: null });
      },
    }),
    {
      name: 'homental-auth',
      partialize: (state) => ({ accessToken: state.accessToken, phone: state.phone, user: state.user }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) setAuthToken(state.accessToken);
      },
    },
  ),
);
