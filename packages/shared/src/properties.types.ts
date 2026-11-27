export type PropertyType = 'RESIDENTIAL' | 'COMMERCIAL' | 'VILLA' | 'OFFICE' | 'INDUSTRIAL';
export type PropertyAssetKind = 'PHOTO' | 'SURVEY_VIDEO' | 'MODEL_3D_GLB' | 'FLOORPLAN_JSON';
export type PropertyAssetStatus = 'PENDING_UPLOAD' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';

export const PROPERTY_TYPE_LABELS_FA: Record<PropertyType, string> = {
  RESIDENTIAL: 'مسکونی',
  COMMERCIAL: 'تجاری / مغازه',
  VILLA: 'ویلایی',
  OFFICE: 'اداری',
  INDUSTRIAL: 'صنعتی / انبار',
};

export const PROPERTY_ASSET_KIND_LABELS_FA: Record<PropertyAssetKind, string> = {
  PHOTO: 'تصویر محل',
  SURVEY_VIDEO: 'ویدئوی بازدید',
  MODEL_3D_GLB: 'مدل سه‌بعدی (GLB)',
  FLOORPLAN_JSON: 'نقشه پلان (JSON)',
};

export const PROPERTY_ASSET_STATUS_META: Record<
  PropertyAssetStatus,
  { labelFa: string; className: string }
> = {
  PENDING_UPLOAD: { labelFa: 'در انتظار بارگذاری', className: 'bg-slate-100 text-slate-600' },
  UPLOADED: { labelFa: 'بارگذاری‌شده', className: 'bg-sky-50 text-sky-700' },
  PROCESSING: { labelFa: 'در حال پردازش', className: 'bg-amber-50 text-amber-800' },
  READY: { labelFa: 'آماده', className: 'bg-emerald-50 text-emerald-700' },
  FAILED: { labelFa: 'ناموفق', className: 'bg-red-50 text-red-600' },
};

export interface PropertyDimensions {
  areaM2?: number;
  ceilingHeightCm?: number;
  floorsCount?: number;
  [key: string]: unknown;
}

export interface PropertyMediaAssetView {
  id: string;
  propertyId: string;
  kind: PropertyAssetKind;
  status: PropertyAssetStatus;
  storageKey: string;
  mimeType: string;
  sizeBytes: string;
  publicUrl: string | null;
  spatialMetadataJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPropertyView {
  id: string;
  userId: string;
  cityId: string | null;
  city?: { id: string; slug: string; nameFa: string } | null;
  title: string;
  propertyType: PropertyType;
  address: string;
  lat: number;
  lng: number;
  notes: string | null;
  defaultDimensionsJson: PropertyDimensions | null;
  isArchived: boolean;
  mediaCount: number;
  photoCount: number;
  hasReady3dModel: boolean;
  latestReady3dModel: PropertyMediaAssetView | null;
  latestPhoto: PropertyMediaAssetView | null;
  mediaAssets?: PropertyMediaAssetView[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderPropertySummary {
  id: string;
  title: string;
  propertyType: PropertyType;
  address: string;
  lat: number;
  lng: number;
  notes: string | null;
  defaultDimensionsJson: PropertyDimensions | null;
  mediaCount: number;
  hasReady3dModel: boolean;
  mediaAssets: PropertyMediaAssetView[];
}

export interface CreatePropertyInput {
  cityId?: string;
  title: string;
  propertyType: PropertyType;
  address: string;
  lat: number;
  lng: number;
  notes?: string;
  defaultDimensionsJson?: PropertyDimensions;
}

export interface UpdatePropertyInput {
  cityId?: string | null;
  title?: string;
  propertyType?: PropertyType;
  address?: string;
  lat?: number;
  lng?: number;
  notes?: string | null;
  defaultDimensionsJson?: PropertyDimensions | null;
}

export interface PresignPropertyMediaInput {
  kind: PropertyAssetKind;
  mimeType: string;
  sizeBytes: number;
  fileName?: string;
}

export interface PresignPropertyMediaResult {
  assetId: string;
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

export interface CompletePropertyMediaInput {
  spatialMetadataJson?: Record<string, unknown>;
}
