'use client';

import { createAuthStore } from '@homental/api-client';

export const CUSTOMER_AUTH_STORAGE_KEY = 'homental-customer-auth';

export const useAuthStore = createAuthStore({
  storageKey: CUSTOMER_AUTH_STORAGE_KEY,
  deviceInfo: 'Homental Customer Web',
});
