'use client';

import type {
  Advisory,
  CatalogResponse,
  CityDto,
  OrderResult,
  PricingResult,
  ServiceKey,
  SupplyMode,
  UrgencyLevel,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

/** Tokens live here; auth.store mirrors them (persisted) and listens for clears. */
const tokens: { access: string | null; refresh: string | null } = { access: null, refresh: null };
const authClearedListeners: Array<() => void> = [];

export function setTokens(access: string | null, refresh: string | null): void {
  tokens.access = access;
  tokens.refresh = refresh;
}

/** Registers a callback fired when the session is cleared (failed refresh). */
export function onAuthCleared(listener: () => void): void {
  authClearedListeners.push(listener);
}

function clearAuth(): void {
  tokens.access = null;
  tokens.refresh = null;
  for (const listener of authClearedListeners) listener();
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorEnvelope {
  message?: string | string[];
  statusCode?: number;
}

// ── Automatic Refresh-Token Rotation (single-flight mutex) ────────────────────

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!tokens.refresh) return false;
  if (refreshInFlight) return refreshInFlight;

  const promise = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refresh }),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { accessToken: string; refreshToken: string };
      tokens.access = body.accessToken;
      tokens.refresh = body.refreshToken;
      return true;
    } catch {
      return false;
    }
  })();
  refreshInFlight = promise;
  // Clear the mutex once every waiter has resumed.
  void promise.finally(() => {
    refreshInFlight = null;
  });
  return promise;
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (tokens.access) headers['Authorization'] = `Bearer ${tokens.access}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError('ارتباط با سرور هومنتال برقرار نشد؛ اتصال اینترنت را بررسی کنید.', 0);
  }

  // Seamless rotation: one 401 → single-flight refresh → retry the original call.
  if (response.status === 401 && tokens.refresh && !retried && !path.startsWith('/auth/')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, init, true);
    clearAuth();
  }

  const body = (await response.json().catch(() => null)) as (ErrorEnvelope & Record<string, unknown>) | null;
  if (!response.ok) {
    const message =
      typeof body?.message === 'string'
        ? body.message
        : Array.isArray(body?.message)
          ? body.message.join(' | ')
          : 'خطای غیرمنتظره در ارتباط با سرور.';
    throw new ApiError(message, response.status, body ?? undefined);
  }
  return body as T;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export interface AdvisorEvaluatePayload {
  locationType: string;
  buildingContext?: Record<string, unknown>;
  servicesConfig?: Record<string, Record<string, unknown>>;
  includePricing?: boolean;
  citySlug?: string;
  urgency?: UrgencyLevel;
  supplyMode?: SupplyMode;
}

export const api = {
  catalogSchemas: (locationType?: string) =>
    request<CatalogResponse>(
      `/catalog/schemas${locationType ? `?locationType=${locationType}` : ''}`,
    ),

  advisorEvaluate: (payload: AdvisorEvaluatePayload) =>
    request<EvaluateResponse>('/advisor/evaluate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  cities: () => request<CityDto[]>('/cities'),

  otpRequest: (phone: string) =>
    request<{ sent: boolean; devCode?: string }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  otpVerify: (phone: string, code: string, deviceInfo?: string) =>
    request<{ accessToken: string; refreshToken: string; user: { id: string; phone: string; role: string } }>(
      '/auth/otp/verify',
      { method: 'POST', body: JSON.stringify({ phone, code, deviceInfo }) },
    ),

  authMe: () =>
    request<{ id: string; phone: string; role: string; branchId: string | null }>('/auth/me'),

  // ── Orders ────────────────────────────────────────────────────────────────

  createAddress: (payload: {
    cityId: string;
    titleFa: string;
    locationType: string;
    fullAddressFa: string;
    lat: number;
    lng: number;
    isDefault?: boolean;
  }) =>
    request<{ id: string }>('/users/me/addresses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createOrder: (payload: {
    addressId: string;
    urgency: UrgencyLevel;
    supplyMode: SupplyMode;
    items: Array<{ serviceKey: string; supplyMode?: SupplyMode; config?: Record<string, unknown> }>;
  }) =>
    request<OrderResult>('/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  orders: () => request<OrdersPage>('/orders'),
  order: (id: string) => request<OrderDetail>(`/orders/${id}`),
  submitOrder: (id: string) =>
    request<{ orderId: string; state: string }>(`/orders/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  branchQueue: (id: string) =>
    request<{ orderId: string; state: string }>(`/orders/${id}/branch-queue`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  assignTechnician: (id: string, technicianUserId: string) =>
    request<{ orderId: string; state: string; technicianId: string }>(
      `/orders/${id}/assign-technician`,
      { method: 'POST', body: JSON.stringify({ technicianUserId }) },
    ),
  enRoute: (id: string) =>
    request<{ orderId: string; state: string }>(`/orders/${id}/en-route`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  startInspection: (id: string) =>
    request<{ orderId: string; state: string }>(`/orders/${id}/start-inspection`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  quote: (id: string, finalQuoteAmount: number) =>
    request<{ orderId: string; finalQuoteAmount: number }>(`/orders/${id}/quote`, {
      method: 'POST',
      body: JSON.stringify({ finalQuoteAmount }),
    }),
  approveQuote: (id: string) =>
    request<{ orderId: string; state: string }>(`/orders/${id}/approve-quote`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  startWork: (id: string) =>
    request<{ orderId: string; state: string }>(`/orders/${id}/start-work`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  cancelOrder: (id: string, reason?: string) =>
    request<{ orderId: string; state: string }>(`/orders/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  reviewOrder: (id: string, rating: number, commentFa?: string) =>
    request<Record<string, unknown>>(`/orders/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ rating, commentFa }),
    }),

  // ── Handover gate (technician) ────────────────────────────────────────────

  registerHardwareUnits: (
    id: string,
    units: Array<{ orderItemId: string; categoryFa: string; brand?: string; model?: string; serialNumber: string }>,
  ) =>
    request<{ registered: number }>(`/orders/${id}/hardware-units`, {
      method: 'POST',
      body: JSON.stringify({ units }),
    }),

  requestHandover: (id: string, defaultPasswordsChanged: boolean, technicianAccessRevoked: boolean) =>
    request<{ orderId: string; state: string; devHandoverOtp?: string }>(
      `/orders/${id}/request-handover`,
      { method: 'POST', body: JSON.stringify({ defaultPasswordsChanged, technicianAccessRevoked }) },
    ),

  completeHandover: (id: string, otp: string) =>
    request<{ orderId: string; state: string; warranty: { policyNumber: string; coverageMonths: number } }>(
      `/orders/${id}/complete-handover`,
      { method: 'POST', body: JSON.stringify({ otp }) },
    ),

  resendHandoverOtp: (id: string) =>
    request<{ orderId: string; resent: boolean; devHandoverOtp?: string }>(
      `/orders/${id}/resend-handover-otp`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  // ── Wallet ────────────────────────────────────────────────────────────────

  walletMe: (page = 1, limit = 20) =>
    request<WalletMe>(`/wallet/me?page=${page}&limit=${limit}`),

  walletTopup: (amount: number, idempotencyKey: string) =>
    request<Record<string, unknown>>('/wallet/topup', {
      method: 'POST',
      body: JSON.stringify({ amount, idempotencyKey }),
    }),

  // ── Warranties & claims ───────────────────────────────────────────────────

  warrantiesMe: () => request<WarrantyCard[]>('/warranties/me'),

  createWarrantyClaim: (warrantyId: string, descriptionFa: string) =>
    request<{ claim: WarrantyClaim; warrantyStatus: string }>(`/warranties/${warrantyId}/claims`, {
      method: 'POST',
      body: JSON.stringify({ descriptionFa }),
    }),

  adminWarrantyClaims: () => request<AdminWarrantyClaim[]>('/admin/warranty-claims'),

  updateWarrantyClaim: (
    claimId: string,
    status: string,
    resolutionNoteFa?: string,
  ) =>
    request<{ claim: WarrantyClaim; warrantyStatus: string }>(
      `/admin/warranty-claims/${claimId}`,
      { method: 'PATCH', body: JSON.stringify({ status, resolutionNoteFa }) },
    ),

  // ── Dispatch (technician) ─────────────────────────────────────────────────

  dispatchStatus: (payload: {
    isOnline: boolean;
    isAcceptingOffers?: boolean;
    lat?: number;
    lng?: number;
  }) =>
    request<{ technicianId: string; isOnline: boolean; isAcceptingOffers: boolean }>(
      '/dispatch/technician/status',
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  dispatchLocation: (payload: { lat: number; lng: number }) =>
    request<{ technicianId: string; lat: number; lng: number }>('/dispatch/technician/location', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  acceptOffer: (offerId: string) =>
    request<{ orderId: string; state: string; offerId: string }>(
      `/dispatch/offers/${offerId}/accept`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  declineOffer: (offerId: string) =>
    request<{ offerId: string; status: string }>(`/dispatch/offers/${offerId}/decline`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // ── Admin (branch panel) ──────────────────────────────────────────────────

  adminTechnicians: () => request<AdminTechniciansPage>('/admin/technicians'),

  createTechnician: (payload: {
    phone: string;
    firstName?: string;
    lastName?: string;
    branchId: string;
    skills: string[];
  }) =>
    request<Record<string, unknown>>('/admin/technicians', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTechnician: (profileId: string, payload: { status?: string; skills?: string[] }) =>
    request<Record<string, unknown>>(`/admin/technicians/${profileId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
};

// ── Response DTOs ─────────────────────────────────────────────────────────────

export interface EvaluateResponse {
  readiness: {
    physical: number;
    intrusion: number;
    monitoring: number;
    total: number;
    levelFa: string;
  };
  advisories: Advisory[];
  smartBrief: {
    locationType: string;
    activeServiceKeys: ServiceKey[];
    coveredPillars: string[];
    missingPillars: string[];
  };
  pricing?: PricingResult;
}

export interface OrdersPage {
  items: OrderRow[];
  total: number;
  page: number;
  limit: number;
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  customerId: string;
  technicianId: string | null;
  branchId: string | null;
  state: string;
  finalQuoteAmount: string | null;
  urgency?: string;
  supplyMode?: SupplyMode;
  cancelReason?: string | null;
  createdAt: string;
  items?: Array<{
    id: string;
    supplyMode: SupplyMode | null;
    config?: Record<string, unknown>;
    serviceDefinition?: { key: ServiceKey; titleFa: string };
  }>;
  serviceDefinition?: { key: ServiceKey; titleFa: string };
}

export interface OrderDetail extends OrderRow {
  stateTransitions: Array<{
    id: string;
    fromState: string | null;
    toState: string;
    reason: string | null;
    createdAt: string;
  }>;
  review: { id: string; rating: number; commentFa: string | null } | null;
}

export interface WalletMe {
  wallet: { id: string; balance: string; heldInEscrow: string };
  transactions: Array<{
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    description: string | null;
    createdAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
}

export interface WarrantyCard {
  id: string;
  policyNumber: string;
  status: string;
  coverageMonths: number;
  startDate: string;
  endDate: string;
  daysRemaining: number;
  coverage?: Array<{ serviceKey?: string; titleFa?: string; serials?: string[] }>;
  claims: WarrantyClaim[];
  order?: { id: string; orderNumber: string; completedAt: string | null };
}

export interface WarrantyClaim {
  id: string;
  warrantyId: string;
  status: string;
  descriptionFa: string;
  resolutionNoteFa: string | null;
  createdAt: string;
  warranty?: {
    id: string;
    policyNumber: string;
    order?: { id: string; orderNumber: string; branchId: string | null; customerId: string };
  };
}

export type AdminWarrantyClaim = WarrantyClaim;

export interface AdminTechniciansPage {
  items: Array<{
    id: string;
    userId: string;
    branchId: string | null;
    status: string;
    skills: string[];
    rating: string;
    ratingCount: number;
    warrantyClaimRate: string;
    isOnline: boolean;
    user: { id: string; phone: string; firstName: string | null; lastName: string | null };
  }>;
  total: number;
}

export type { PricingResult, Advisory, CatalogResponse, CityDto, OrderResult, UrgencyLevel, SupplyMode, ServiceKey };
