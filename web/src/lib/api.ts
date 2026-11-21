import type {
  CatalogResponse,
  CityDto,
  EvaluateResponse,
  OrderResult,
  SupplyMode,
  UrgencyLevel,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

/** Module-level JWT access token (wired by the auth store on login/logout). */
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError('ارتباط با سرور هومنتال برقرار نشد؛ اتصال اینترنت را بررسی کنید.', 0);
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

  submitOrder: (orderId: string) =>
    request<{ orderId: string; state: string }>(`/orders/${orderId}/submit`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
