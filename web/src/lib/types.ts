/** Types mirroring the Homental `/api/v1` backend contracts. */

export type LocationType = 'APARTMENT' | 'VILLA' | 'SHOP' | 'PARKING' | 'WAREHOUSE';
export type SecurityPillar = 'PHYSICAL' | 'INTRUSION' | 'MONITORING';
export type ServiceKey = 'ELECTRIC_SHUTTER' | 'PARKING_JACK' | 'ALARM' | 'CCTV';
export type SupplyMode = 'FULL_PACKAGE' | 'INSTALL_ONLY';
export type UrgencyLevel = 'SCHEDULED' | 'SAME_DAY' | 'EMERGENCY';

export interface UiField {
  id: string;
  type: 'STEPPER' | 'CHIPS' | 'SWITCH';
  labelFa: string;
  descriptionFa?: string;
  unitFa?: string;
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  select?: 'SINGLE' | 'MULTI';
  options?: Array<{ value: string; labelFa: string; hintFa?: string }>;
  locationTypes?: string[];
  pricingVar?: string;
}

export interface GoalCard {
  id: string;
  titleFa: string;
  descriptionFa?: string;
  iconKey?: string;
  locationTypes?: string[];
}

export interface UiSchema {
  titleFa?: string;
  steps?: Array<{ id: string; titleFa: string; descriptionFa?: string; fields: UiField[] }>;
  goalCards?: { titleFa?: string; multiSelect?: boolean; cards?: GoalCard[] };
}

export interface PublicService {
  key: ServiceKey;
  pillar: SecurityPillar;
  version: number;
  titleFa: string;
  subtitleFa: string | null;
  descriptionFa: string | null;
  iconKey: string | null;
  supportedLocationTypes: LocationType[];
  warrantyMonths: number;
  uiSchema: UiSchema;
}

export interface PillarGroup {
  pillar: SecurityPillar;
  titleFa: string;
  subtitleFa: string;
  services: PublicService[];
}

export interface RecommendedPreset {
  locationType: LocationType;
  questionFa: string;
  titleFa: string;
  starters: Array<{ serviceKey: ServiceKey; config: Record<string, unknown>; hintFa: string }>;
}

export interface CatalogResponse {
  pillars: PillarGroup[];
  recommendedPreset: RecommendedPreset | null;
}

export interface SuggestedAction {
  type: 'APPLY_SERVICE_CONFIG';
  serviceKey: ServiceKey;
  configPatch: Record<string, unknown>;
}

export interface Advisory {
  code: string;
  pillar: SecurityPillar;
  priority: number;
  messageFa: string;
  scoreImpact: Record<string, unknown> | null;
  suggestedAction: SuggestedAction | null;
}

export interface ReadinessScore {
  physical: number;
  intrusion: number;
  monitoring: number;
  total: number;
  levelFa: string;
}

export interface SmartBrief {
  locationType: string;
  activeServiceKeys: ServiceKey[];
  coveredPillars: string[];
  missingPillars: string[];
}

export interface InvoiceLine {
  lineKey: string;
  sku?: string | null;
  titleFa: string;
  unit: 'EACH' | 'METER';
  qty: number;
  quantityCm?: number | null;
  unitPrice: string;
  lineTotal: string;
}

export interface BargainingSlider {
  sliderBps: number;
  minDeltaBps: number;
  maxDeltaBps: number;
  priorityThresholdBps: number;
  packageBaseAmount: string;
  dispatchAudience: 'TOP' | 'ALL';
}

export interface ManagedInvoice {
  buckets: Array<{
    bucket: 'FIXED' | 'SERVICE_PACKAGE' | 'METERED';
    titleFa: string;
    badgeFa?: string;
    subtotal: string;
    lines: InvoiceLine[];
  }>;
  total: string;
}

export interface PricingResult {
  currency: 'TOMAN';
  estimatedMin: string;
  estimatedMax: string;
  netEstimated: string;
  invoice: ManagedInvoice;
  slider?: BargainingSlider | null;
  summary: {
    totalHardware: string;
    bundleDiscountPercent: number;
  };
  factors: {
    surge: { multiplier: number; reasonFa: string };
    urgency: { urgency: UrgencyLevel; multiplier: number };
  };
}

export interface EvaluateResponse {
  readiness: ReadinessScore;
  advisories: Advisory[];
  smartBrief: SmartBrief;
  pricing?: PricingResult;
}

export interface CityDto {
  id: string;
  slug: string;
  nameFa: string;
}

export interface OrderResult {
  order: { id: string; orderNumber: string; state: string };
  estimate: PricingResult;
}
