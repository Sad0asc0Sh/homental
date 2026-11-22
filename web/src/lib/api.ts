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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

/** Tokens live here; auth.store mirrors them (persisted) and listens for updates/clears. */
const tokens: { access: string | null; refresh: string | null } = { access: null, refresh: null };

let tokensUpdatedListener: ((access: string, refresh: string) => void) | null = null;
let authClearedListener: (() => void) | null = null;

export function setTokens(access: string | null, refresh: string | null): void {
  tokens.access = access;
  tokens.refresh = refresh;
}

/** Subscribes to rotated access/refresh token pairs from automatic 401 refresh. */
export function onTokensUpdated(listener: (access: string, refresh: string) => void): void {
  tokensUpdatedListener = listener;
}

/** Subscribes to session clears triggered when refresh rotation fails. */
export function onAuthCleared(listener: () => void): void {
  authClearedListener = listener;
}

function clearAuth(): void {
  tokens.access = null;
  tokens.refresh = null;
  authClearedListener?.();
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
  const refreshToken = tokens.refresh;
  if (!refreshToken) return false;
  if (refreshInFlight) return refreshInFlight;

  const promise = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { accessToken: string; refreshToken: string };
      // If user explicitly logged out while refresh was in flight, do not revive session.
      if (!tokens.refresh) return false;
      tokens.access = body.accessToken;
      tokens.refresh = body.refreshToken;
      tokensUpdatedListener?.(body.accessToken, body.refreshToken);
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
  const sentAccessToken = tokens.access;
  if (sentAccessToken) headers['Authorization'] = `Bearer ${sentAccessToken}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError('ارتباط با سرور هومنتال برقرار نشد؛ اتصال اینترنت را بررسی کنید.', 0);
  }

  // Seamless rotation: one 401 → single-flight refresh (or reuse rotated token) → retry once.
  if (response.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (tokens.access && tokens.access !== sentAccessToken) {
      return request<T>(path, init, true);
    }
    if (tokens.refresh) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return request<T>(path, init, true);
      clearAuth();
    }
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

  logout: (refreshToken: string) =>
    request<{ revoked: boolean }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

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

  orders: (params?: { page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<OrdersPage>(`/orders${qs ? `?${qs}` : ''}`);
  },
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

  dispatchMe: () => request<TechnicianMe>('/dispatch/technician/me'),

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

  adminBranches: () => request<AdminBranch[]>('/admin/branches'),

  adminTechnicians: (params?: { status?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<AdminTechniciansPage>(`/admin/technicians${qs ? `?${qs}` : ''}`);
  },

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

  // ── Super Admin Control & Finance ─────────────────────────────────────────

  adminFinanceSummary: () => request<AdminFinanceSummary>('/admin/finance/summary'),

  adminCities: () => request<AdminCity[]>('/admin/cities'),

  createCity: (payload: {
    slug: string;
    nameFa: string;
    nameEn: string;
    centerLat: number;
    centerLng: number;
    launchOrder?: number;
  }) =>
    request<AdminCity>('/admin/cities', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCity: (
    cityId: string,
    payload: {
      slug?: string;
      nameFa?: string;
      nameEn?: string;
      centerLat?: number;
      centerLng?: number;
      launchOrder?: number;
      isActive?: boolean;
    },
  ) =>
    request<AdminCity>(`/admin/cities/${cityId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  createBranch: (payload: {
    cityId: string;
    code: string;
    nameFa: string;
    addressFa: string;
    phone?: string;
    lat: number;
    lng: number;
    serviceRadiusMeters?: number;
    hasPhysicalShowroom?: boolean;
    commissionRateOverride?: number | null;
    warrantyReserveOverride?: number | null;
    isActive?: boolean;
  }) =>
    request<AdminBranch>('/admin/branches', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateBranch: (
    branchId: string,
    payload: {
      nameFa?: string;
      addressFa?: string;
      phone?: string;
      lat?: number;
      lng?: number;
      serviceRadiusMeters?: number;
      hasPhysicalShowroom?: boolean;
      commissionRateOverride?: number | null;
      warrantyReserveOverride?: number | null;
      isActive?: boolean;
    },
  ) =>
    request<AdminBranch>(`/admin/branches/${branchId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminAdvisoryRules: () => request<AdminAdvisoryRule[]>('/admin/advisory/rules'),

  createAdvisoryRule: (payload: {
    code: string;
    pillar: string;
    priority?: number;
    appliesToLocationTypes?: string[];
    condition: Record<string, unknown>;
    suggestedActionFa: string;
    suggestedServiceKey?: ServiceKey;
    suggestedConfig?: Record<string, unknown>;
    scoreImpact?: Record<string, unknown>;
  }) =>
    request<AdminAdvisoryRule>('/admin/advisory/rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdvisoryRule: (
    ruleId: string,
    payload: {
      pillar?: string;
      priority?: number;
      appliesToLocationTypes?: string[];
      condition?: Record<string, unknown>;
      suggestedActionFa?: string;
      suggestedServiceKey?: ServiceKey;
      suggestedConfig?: Record<string, unknown>;
      scoreImpact?: Record<string, unknown>;
      isActive?: boolean;
    },
  ) =>
    request<AdminAdvisoryRule>(`/admin/advisory/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminPlatformConfig: () => request<PlatformConfigEntry[]>('/admin/platform-config'),

  updatePlatformConfig: (key: string, value: Record<string, unknown>) =>
    request<PlatformConfigEntry>(`/admin/platform-config/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
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
  pricing?: { netEstimated?: string; estimatedMin?: string; estimatedMax?: string } | null;
  urgency?: string;
  supplyMode?: SupplyMode;
  cancelReason?: string | null;
  completedAt?: string | null;
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

export interface TechnicianMe {
  technicianId: string;
  status: string;
  isOnline: boolean;
  isAcceptingOffers: boolean;
  lastKnownLat: number | null;
  lastKnownLng: number | null;
  rating: number;
  ratingCount: number;
  completedJobs: number;
  warrantyClaimRate: number;
}

export interface AdminBranch {
  id: string;
  cityId: string;
  code: string;
  nameFa: string;
  addressFa: string;
  phone: string | null;
  lat: number;
  lng: number;
  serviceRadiusMeters: number;
  hasPhysicalShowroom: boolean;
  commissionRateOverride: number | null;
  warrantyReserveOverride: number | null;
  isActive: boolean;
  city?: { id: string; slug: string; nameFa: string };
}

export interface AdminCity {
  id: string;
  slug: string;
  nameFa: string;
  nameEn: string;
  isActive: boolean;
  launchOrder: number;
  centerLat: number;
  centerLng: number;
  _count?: { branches: number };
}

export interface AdminBranchFinanceRow {
  branchId: string;
  branchCode: string;
  nameFa: string;
  cityNameFa: string | null;
  isActive: boolean;
  hasPhysicalShowroom: boolean;
  commissionRateOverride: number | null;
  warrantyReserveOverride: number | null;
  effectiveCommissionRate: number;
  effectiveWarrantyReserveRate: number;
  orderCount: number;
  completedOrderCount: number;
  completedRevenue: string;
}

export interface AdminFinanceSummary {
  platformBalance: string;
  totalPlatformCommission: string;
  totalWarrantyReserve: string;
  totalTechnicianPayout: string;
  activeHeldInEscrow: string;
  defaultCommissionRate: number;
  defaultWarrantyReserveRate: number;
  branches: AdminBranchFinanceRow[];
}

export interface AdminAdvisoryRule {
  id: string;
  code: string;
  pillar: string;
  priority: number;
  appliesToLocationTypes: string[];
  condition: Record<string, unknown>;
  suggestedActionFa: string;
  suggestedServiceKey: ServiceKey | null;
  suggestedConfig: Record<string, unknown> | null;
  scoreImpact: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformConfigEntry {
  key: string;
  value: Record<string, unknown>;
  updatedAt: string | null;
  updatedBy: string | null;
}

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
