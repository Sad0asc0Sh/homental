'use client';

import { createAuthStore } from '@homental/api-client';

export const PARTNERS_AUTH_STORAGE_KEY = 'homental-partners-auth';

export const useAuthStore = createAuthStore({
  storageKey: PARTNERS_AUTH_STORAGE_KEY,
  deviceInfo: 'Homental Partners Web',
});
