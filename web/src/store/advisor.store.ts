'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';
import type {
  Advisory,
  CatalogResponse,
  EvaluateResponse,
  LocationType,
  PricingResult,
  ReadinessScore,
  ServiceKey,
  SmartBrief,
  SupplyMode,
  UrgencyLevel,
} from '@/lib/types';

export interface ServiceSelection {
  enabled: boolean;
  supplyMode: SupplyMode;
  /** Sparse user answers — the backend merges `pricingSchema.variables` defaults. */
  config: Record<string, unknown>;
}

interface AdvisorState {
  locationType: LocationType | null;
  catalog: CatalogResponse | null;
  isLoadingCatalog: boolean;
  selected: Partial<Record<ServiceKey, ServiceSelection>>;
  buildingContext: Record<string, unknown>;
  urgency: UrgencyLevel;
  readiness: ReadinessScore | null;
  advisories: Advisory[];
  dismissedAdvisories: string[];
  smartBrief: SmartBrief | null;
  pricing: PricingResult | null;
  isEvaluating: boolean;
  evaluateError: string | null;
  selectedOrderId: string | null;

  loadCatalog: (locationType: LocationType | null, applyPreset?: boolean) => Promise<void>;
  toggleService: (key: ServiceKey) => void;
  setSupplyMode: (key: ServiceKey, supplyMode: SupplyMode) => void;
  setConfigValue: (key: ServiceKey, field: string, value: unknown) => void;
  toggleGoal: (key: ServiceKey, goalId: string) => void;
  setBuildingContextValue: (field: string, value: unknown) => void;
  setUrgency: (urgency: UrgencyLevel) => void;
  applyAdvisory: (advisory: Advisory) => void;
  dismissAdvisory: (code: string) => void;
  setSelectedOrderId: (orderId: string) => void;
  evaluate: () => Promise<void>;
  reset: () => void;
}

const EVALUATE_DEBOUNCE_MS = 300;
let evaluateTimer: ReturnType<typeof setTimeout> | undefined;
let evaluateSeq = 0;

/** Merges a suggested `configPatch` into the (possibly nested) target config. */
function mergePatch(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...patch };
}

export const useAdvisorStore = create<AdvisorState>()((set, get) => {
  /** Collects the live servicesConfig document + fires the debounced evaluate. */
  const scheduleEvaluate = () => {
    if (evaluateTimer) clearTimeout(evaluateTimer);
    evaluateTimer = setTimeout(() => {
      void get().evaluate();
    }, EVALUATE_DEBOUNCE_MS);
  };

  const buildServicesConfig = () => {
    const servicesConfig: Record<string, Record<string, unknown>> = {};
    for (const [key, selection] of Object.entries(get().selected)) {
      if (!selection?.enabled) continue;
      servicesConfig[key] = {
        active: true,
        ...selection.config,
        supplyMode: selection.supplyMode,
      };
    }
    return servicesConfig;
  };

  return {
    locationType: null,
    catalog: null,
    isLoadingCatalog: false,
    selected: {},
    buildingContext: {},
    urgency: 'SCHEDULED',
    readiness: null,
    advisories: [],
    dismissedAdvisories: [],
    smartBrief: null,
    pricing: null,
    isEvaluating: false,
    evaluateError: null,
    selectedOrderId: null,

    loadCatalog: async (locationType, applyPreset = true) => {
      set({ isLoadingCatalog: true, locationType });
      try {
        const catalog = await api.catalogSchemas(locationType ?? undefined);
        const selected: Partial<Record<ServiceKey, ServiceSelection>> = applyPreset
          ? {}
          : get().selected;
        // Dual-Path Path 1: preload the backend's recommended starter configs —
        // fully editable by the user afterwards.
        if (applyPreset && catalog.recommendedPreset) {
          for (const starter of catalog.recommendedPreset.starters) {
            selected[starter.serviceKey] = {
              enabled: true,
              supplyMode: 'FULL_PACKAGE',
              config: { ...starter.config },
            };
          }
        }
        set({ catalog, selected, isLoadingCatalog: false });
        scheduleEvaluate();
      } catch (error) {
        set({
          isLoadingCatalog: false,
          evaluateError: error instanceof Error ? error.message : 'خطا در دریافت کاتالوگ.',
        });
      }
    },

    toggleService: (key) => {
      const current = get().selected[key];
      set({
        selected: {
          ...get().selected,
          [key]: {
            enabled: !current?.enabled,
            supplyMode: current?.supplyMode ?? 'FULL_PACKAGE',
            config: current?.config ?? {},
          },
        },
      });
      scheduleEvaluate();
    },

    setSupplyMode: (key, supplyMode) => {
      const current = get().selected[key];
      if (!current) return;
      set({ selected: { ...get().selected, [key]: { ...current, supplyMode } } });
      scheduleEvaluate();
    },

    setConfigValue: (key, field, value) => {
      const current = get().selected[key];
      if (!current) return;
      set({
        selected: {
          ...get().selected,
          [key]: { ...current, config: { ...current.config, [field]: value } },
        },
      });
      scheduleEvaluate();
    },

    toggleGoal: (key, goalId) => {
      const current = get().selected[key];
      if (!current) return;
      const goals = Array.isArray(current.config['goals'])
        ? (current.config['goals'] as string[])
        : [];
      const nextGoals = goals.includes(goalId)
        ? goals.filter((goal) => goal !== goalId)
        : [...goals, goalId];
      set({
        selected: {
          ...get().selected,
          [key]: { ...current, config: { ...current.config, goals: nextGoals } },
        },
      });
      scheduleEvaluate();
    },

    setBuildingContextValue: (field, value) => {
      set({ buildingContext: { ...get().buildingContext, [field]: value } });
      scheduleEvaluate();
    },

    setUrgency: (urgency) => {
      set({ urgency });
      scheduleEvaluate();
    },

    applyAdvisory: (advisory) => {
      const action = advisory.suggestedAction;
      if (!action) return;
      const current = get().selected[action.serviceKey];
      set({
        selected: {
          ...get().selected,
          [action.serviceKey]: {
            enabled: true, // one-click apply auto-enables the suggested service
            supplyMode: current?.supplyMode ?? 'FULL_PACKAGE',
            config: mergePatch(current?.config ?? {}, action.configPatch),
          },
        },
        dismissedAdvisories: [...get().dismissedAdvisories, advisory.code],
      });
      scheduleEvaluate();
    },

    dismissAdvisory: (code) => {
      set({ dismissedAdvisories: [...get().dismissedAdvisories, code] });
    },

    setSelectedOrderId: (orderId) => {
      set({ selectedOrderId: orderId });
    },

    evaluate: async () => {
      const state = get();
      if (!state.locationType) return;
      const seq = ++evaluateSeq;
      set({ isEvaluating: true, evaluateError: null });
      try {
        const result = await api.advisorEvaluate({
          locationType: state.locationType,
          buildingContext: state.buildingContext,
          servicesConfig: buildServicesConfig(),
          includePricing: true,
          citySlug: 'mashhad',
          urgency: state.urgency,
        });
        if (seq !== evaluateSeq) return; // stale response — drop it
        set({
          readiness: result.readiness,
          advisories: result.advisories,
          smartBrief: result.smartBrief,
          pricing: result.pricing ?? null,
          isEvaluating: false,
        });
      } catch (error) {
        if (seq !== evaluateSeq) return;
        set({
          isEvaluating: false,
          evaluateError: error instanceof Error ? error.message : 'خطا در ارزیابی هوشمند.',
        });
      }
    },

    reset: () => {
      set({
        locationType: null,
        catalog: null,
        selected: {},
        buildingContext: {},
        urgency: 'SCHEDULED',
        readiness: null,
        advisories: [],
        dismissedAdvisories: [],
        smartBrief: null,
        pricing: null,
        selectedOrderId: null,
      });
    },
  };
});

/** Selector: all currently enabled service keys (bundle-size driver). */
export function enabledServiceKeys(state: AdvisorState): ServiceKey[] {
  return Object.entries(state.selected)
    .filter(([, selection]) => selection?.enabled)
    .map(([key]) => key as ServiceKey);
}
