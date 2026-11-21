import { BadRequestException, Injectable } from '@nestjs/common';
import { SupplyMode } from '@prisma/client';
import { JsonLogicEvaluator } from '../shared/json-logic.evaluator';

export interface HardwareLine {
  ref: string;
  labelFa: string;
  qty: number;
  unitPrice: number;
  lineTotal: bigint;
}

export interface LaborLine {
  labelFa: string;
  amount: bigint;
}

export interface AppliedComplexity {
  labelFa: string;
  multiplier: number;
}

export interface PriceRange {
  minAdjustPct: number;
  maxAdjustPct: number;
}

export interface InterpretationResult {
  serviceKey: string;
  supplyMode: SupplyMode;
  hardwareLines: HardwareLine[];
  hardwareSubtotal: bigint;
  hardwareDropped: boolean;
  laborLines: LaborLine[];
  appliedComplexities: AppliedComplexity[];
  laborSubtotal: bigint;
  dispatchFee: bigint;
  range: PriceRange;
}

interface LineItemLike {
  ref?: string;
  labelFa?: string;
  qty?: unknown;
  unitPrice?: number;
  unitPriceByOption?: { variable: string; options: Record<string, number> };
  unitPriceLogic?: unknown;
}

interface LaborSchemaLike {
  base?: { labelFa?: string; amount?: number };
  perUnit?: Array<Record<string, unknown>>;
  complexity?: Array<{ labelFa?: string; multiplier?: number; when?: unknown }>;
}

interface PricingSchemaLike {
  variables?: Record<string, unknown>;
  hardware?: { lineItems?: LineItemLike[] };
  labor?: LaborSchemaLike;
  dispatch?: { base?: { labelFa?: string; amount?: number } };
  multipliersApplyTo?: unknown;
  range?: { minAdjustPct?: number; maxAdjustPct?: number };
}

const DYNAMIC_FACTOR_TARGETS = new Set(['labor', 'dispatch']);

/**
 * Interprets ONE service's `pricingSchema` document for a resolved effective
 * `supplyMode`. Purely data-driven (Invariant 14): every quantity, option
 * price and complexity rule is JSON-Logic/config from the JSONB document.
 * All money is integer BigInt Toman (Invariant 1).
 */
@Injectable()
export class PricingSchemaInterpreter {
  constructor(private readonly evaluator: JsonLogicEvaluator) {}

  interpret(params: {
    serviceKey: string;
    pricingSchema: unknown;
    config: Record<string, unknown>;
    supplyMode: SupplyMode;
  }): InterpretationResult {
    const schema = (params.pricingSchema ?? {}) as PricingSchemaLike;
    this.assertHardwareNeverSurged(schema);
    const vars: Record<string, unknown> = { ...(schema.variables ?? {}), ...params.config };

    const hardware = this.interpretHardware(schema, vars, params.supplyMode);
    const labor = this.interpretLabor(schema, vars);
    const dispatchFee = BigInt(Math.max(0, Math.round(Number(schema.dispatch?.base?.amount ?? 0))));

    return {
      serviceKey: params.serviceKey,
      supplyMode: params.supplyMode,
      ...hardware,
      ...labor,
      dispatchFee,
      range: {
        minAdjustPct: schema.range?.minAdjustPct ?? 0,
        maxAdjustPct: schema.range?.maxAdjustPct ?? 0,
      },
    };
  }

  /**
   * Invariant 2 hard-guard: a misconfigured document that lists 'hardware' as
   * a dynamic-factor target is rejected — surge/urgency can NEVER touch
   * hardware prices.
   */
  private assertHardwareNeverSurged(schema: PricingSchemaLike): void {
    const targets = Array.isArray(schema.multipliersApplyTo)
      ? schema.multipliersApplyTo.map(String)
      : ['labor', 'dispatch'];
    if (targets.some((target) => !DYNAMIC_FACTOR_TARGETS.has(target))) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'پیکربندی قیمت نامعتبر است: ضریب‌های داینامیک (شلوغی/فوریت) فقط می‌توانند روی اجرت و اعزام اعمال شوند، هرگز روی سخت‌افزار.',
      });
    }
  }

  private interpretHardware(
    schema: PricingSchemaLike,
    vars: Record<string, unknown>,
    supplyMode: SupplyMode,
  ): Pick<InterpretationResult, 'hardwareLines' | 'hardwareSubtotal' | 'hardwareDropped'> {
    // Invariant 7: INSTALL_ONLY drops hardware entirely, keeps labor/dispatch.
    if (supplyMode === SupplyMode.INSTALL_ONLY) {
      return { hardwareLines: [], hardwareSubtotal: 0n, hardwareDropped: true };
    }

    const lines: HardwareLine[] = [];
    for (const item of schema.hardware?.lineItems ?? []) {
      const qty = this.resolveQty(item.qty, vars);
      if (qty <= 0) continue; // transparent breakdown lists only real lines
      const unitPrice = this.resolveUnitPrice(item, vars);
      lines.push({
        ref: item.ref ?? 'ITEM',
        labelFa: item.labelFa ?? '',
        qty,
        unitPrice,
        lineTotal: BigInt(qty) * BigInt(unitPrice),
      });
    }
    const hardwareSubtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0n);
    return { hardwareLines: lines, hardwareSubtotal, hardwareDropped: false };
  }

  /** Double-guard: JSON-Logic result AND the final value are clamped ≥ 0. */
  private resolveQty(qty: unknown, vars: Record<string, unknown>): number {
    const raw = typeof qty === 'number' ? qty : this.evaluator.evaluateNumber(qty as never, vars);
    return Math.max(0, Math.round(raw));
  }

  private resolveUnitPrice(item: LineItemLike, vars: Record<string, unknown>): number {
    if (typeof item.unitPrice === 'number') return item.unitPrice;

    if (item.unitPriceByOption) {
      const { variable, options } = item.unitPriceByOption;
      const selected = vars[variable];
      const price = options[String(selected)];
      if (typeof price !== 'number') {
        throw new BadRequestException({
          statusCode: 400,
          message: `گزینه «${String(selected)}» برای «${item.labelFa ?? ''}» معتبر نیست.`,
        });
      }
      return price;
    }

    if (item.unitPriceLogic !== undefined && item.unitPriceLogic !== null) {
      return this.evaluator.evaluateNumber(item.unitPriceLogic, vars);
    }

    throw new BadRequestException({
      statusCode: 400,
      message: `قیمت واحد برای «${item.labelFa ?? item.ref ?? ''}» در سند قیمت تعریف نشده است.`,
    });
  }

  private interpretLabor(
    schema: PricingSchemaLike,
    vars: Record<string, unknown>,
  ): Pick<InterpretationResult, 'laborLines' | 'appliedComplexities' | 'laborSubtotal'> {
    const laborLines: LaborLine[] = [];
    const laborSchema = schema.labor ?? {};

    if (typeof laborSchema.base?.amount === 'number') {
      laborLines.push({
        labelFa: laborSchema.base.labelFa ?? 'اجرت پایه',
        amount: BigInt(laborSchema.base.amount),
      });
    }

    for (const entry of laborSchema.perUnit ?? []) {
      const labelFa = String(entry['labelFa'] ?? 'اجرت');
      if (typeof entry['amount'] === 'number') {
        // Conditional flat line (e.g. CCTV mobile-view setup, gated by `when`).
        const when = entry['when'];
        if (when === undefined || this.evaluator.evaluateBoolean(when, vars)) {
          laborLines.push({ labelFa, amount: BigInt(entry['amount'] as number) });
        }
        continue;
      }
      // Per-unit line: billable = max(0, qty − included) × perUnitAmount.
      const qty = this.resolveQty(entry['qty'], vars);
      const included = Number(entry['included'] ?? 0);
      const perUnitAmount = Number(entry['perUnitAmount'] ?? 0);
      const billable = Math.max(0, qty - included);
      if (billable > 0 && perUnitAmount > 0) {
        laborLines.push({ labelFa, amount: BigInt(billable) * BigInt(perUnitAmount) });
      }
    }

    const baseLabor = laborLines.reduce((sum, line) => sum + line.amount, 0n);
    const appliedComplexities: AppliedComplexity[] = [];
    let laborSubtotal = baseLabor;
    for (const rule of laborSchema.complexity ?? []) {
      const when = rule.when;
      if (when !== undefined && !this.evaluator.evaluateBoolean(when, vars)) continue;
      const multiplier = Number(rule.multiplier ?? 1);
      if (multiplier === 1) continue;
      laborSubtotal = BigInt(Math.round(Number(laborSubtotal) * multiplier));
      appliedComplexities.push({ labelFa: rule.labelFa ?? 'ضریب پیچیدگی', multiplier });
    }

    return { laborLines, appliedComplexities, laborSubtotal };
  }
}
