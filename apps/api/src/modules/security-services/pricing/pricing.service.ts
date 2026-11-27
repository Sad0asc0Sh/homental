import { BadRequestException, ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ServiceKey, SupplyMode, UrgencyLevel } from '@prisma/client';
import type { InstallationRateCard } from '@prisma/client';
import { z } from 'zod';
import { BPS, ceilDivide, rateToBps } from '@common/utils/basis-points.util';
import { classifyShipment, deliveryPolicySchema } from '@common/utils/delivery-policy';
import { PrismaService } from '@infra/prisma/prisma.service';
import { dispatchPriorityPolicy } from '../dispatch/dispatch-priority-policy';
import { DynamicFactorsService } from './dynamic-factors.service';
import {
  computeServicePackage,
  toSliderView,
  validateSliderBps,
  type InvoiceLine,
  type ManagedInvoice,
  type ManagedSplit,
  type ManagedTask,
  type PlannedMaterial,
  type PlannedMeteredLabor,
} from './managed-pricing';
import { PricingSchemaInterpreter } from './pricing-schema.interpreter';
import { MAX_QUANTITY_CM, meteredLineAmount, meteredStockQty } from './metered-quantity';

export interface EstimateItemInput {
  serviceKey: string;
  supplyMode?: SupplyMode;
  config?: Record<string, unknown>;
}

export interface EstimateInput {
  citySlug?: string;
  lat?: number;
  lng?: number;
  urgency?: UrgencyLevel;
  supplyMode?: SupplyMode;
  sliderBps?: number;
  items: EstimateItemInput[];
}

export interface PricingEstimateResult {
  currency: 'TOMAN';
  estimatedMin: bigint;
  estimatedMax: bigint;
  netEstimated: bigint;
  invoice: ManagedInvoice;
  slider: ReturnType<typeof toSliderView>;
  summary: { totalHardware: bigint; bundleDiscountPercent: number };
  factors: {
    surge: { multiplier: number; reasonFa: string };
    urgency: { urgency: UrgencyLevel; multiplier: number };
  };
}

const policySchema = z.object({
  version: z.string().min(1),
  fixedTitleFa: z.string().min(1),
  fixedBadgeFa: z.string().min(1),
  packageTitleFa: z.string().min(1),
  meteredTitleFa: z.string().min(1),
  delivery: deliveryPolicySchema,
});
const serviceKeySchema = z.nativeEnum(ServiceKey);

function invoiceLine({ lineKey, sku, titleFa, unit, qty, quantityCm, unitPrice, lineTotal }: InvoiceLine) {
  return { lineKey, sku, titleFa, unit, qty, quantityCm, unitPrice, lineTotal };
}

function rateCardFor(cards: InstallationRateCard[], serviceKey: ServiceKey, branchId?: string) {
  const matches = cards.filter((card) => card.serviceKey === serviceKey);
  return matches.find((card) => card.branchId === branchId) ??
    matches.find((card) => card.branchId === null && card.cityId !== null) ??
    matches.find((card) => card.branchId === null && card.cityId === null);
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly interpreter: PricingSchemaInterpreter,
    private readonly factors: DynamicFactorsService,
  ) {}

  async estimate(input: EstimateInput): Promise<PricingEstimateResult> {
    return (await this.estimateManaged(input)).customerView;
  }

  async estimateManaged(
    input: EstimateInput,
    scope?: { cityId: string; branchId: string | null },
  ) {
    const sliderBps = input.sliderBps === undefined ? 0 : input.sliderBps;
    validateSliderBps(sliderBps);
    const items = input.items.map((item) => {
      const key = serviceKeySchema.safeParse(item.serviceKey);
      if (!key.success) throw new BadRequestException('خدمت انتخاب‌شده در دسترس نیست.');
      return { ...item, serviceKey: key.data };
    });
    const keys = items.map(({ serviceKey }) => serviceKey);
    if (keys.length === 0 || new Set(keys).size !== keys.length) {
      throw new BadRequestException('دست‌کم یک خدمت انتخاب کنید. هر خدمت فقط یک بار قابل انتخاب است.');
    }
    const city = await this.prisma.city.findFirst({
      where: scope ? { id: scope.cityId, isActive: true } : { slug: input.citySlug ?? 'mashhad', isActive: true },
      select: { id: true, slug: true },
    });
    if (!city) throw new BadRequestException('قیمت‌گذاری در شهر انتخاب‌شده در دسترس نیست.');
    const branch = scope?.branchId === null ? null : await this.prisma.branch.findFirst({
      where: { id: scope?.branchId ?? undefined, cityId: city.id, isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, commissionRateOverride: true },
    });
    const [policyRow, splitRow, dispatchRow, definitions, cards, surge, urgency] = await Promise.all([
      this.prisma.platformConfig.findUnique({ where: { key: 'pricing.managed' } }),
      this.prisma.platformConfig.findUnique({ where: { key: 'escrow.split' } }),
      this.prisma.platformConfig.findUnique({ where: { key: 'dispatch.offer' } }),
      this.prisma.serviceDefinition.findMany({ where: { key: { in: keys }, isActive: true } }),
      this.prisma.installationRateCard.findMany({
        where: {
          serviceKey: { in: keys }, isActive: true,
          AND: [
            { OR: [{ cityId: city.id }, { cityId: null }] },
            branch ? { OR: [{ branchId: branch.id }, { branchId: null }] } : { branchId: null },
          ],
        },
        orderBy: [{ version: 'desc' }, { code: 'asc' }],
      }),
      this.factors.getSurge({ citySlug: city.slug, lat: input.lat, lng: input.lng }),
      this.factors.getUrgency(input.urgency ?? UrgencyLevel.SCHEDULED),
    ]);
    const parsed = policySchema.safeParse(policyRow?.value);
    if (!parsed.success) throw new InternalServerErrorException('سیاست قیمت‌گذاری در دسترس نیست.');
    const policy = parsed.data;
    const splitConfig = splitRow?.value as { platformCommissionRate?: number } | null;
    const commissionBps = rateToBps(branch?.commissionRateOverride ?? splitConfig?.platformCommissionRate ?? 0.15);
    const surgeBps = rateToBps(surge.multiplier);
    const urgencyBps = rateToBps(urgency.multiplier);
    const dynamic = (amount: bigint) => ceilDivide(amount * surgeBps * urgencyBps, BPS ** 2n);
    const bundleBps = keys.length >= 3 ? 1000 : keys.length === 2 ? 600 : 0;
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const scopeItems = items.map(({ serviceKey, ...item }) => {
      const definition = byKey.get(serviceKey);
      if (!definition) throw new BadRequestException('خدمت انتخاب‌شده در دسترس نیست.');
      const card = rateCardFor(cards, serviceKey, branch?.id);
      if (!card) throw new ConflictException('تعرفه نصب برای خدمت انتخاب‌شده در دسترس نیست.');
      const supplyMode = item.supplyMode ?? input.supplyMode ?? SupplyMode.FULL_PACKAGE;
      return {
        serviceKey, definition, card, supplyMode,
        work: this.interpreter.interpretManagedScope({
          serviceKey, pricingSchema: definition.pricingSchema, config: item.config ?? {}, supplyMode,
        }),
      };
    });

    const skus = [...new Set(scopeItems.flatMap(({ work }) => work.hardware.map((line) => line.sku)))];
    const offers = skus.length === 0 ? [] : await this.prisma.sellerOffer.findMany({
      where: {
        isActive: true,
        product: { isActive: true, sku: { in: skus } },
        seller: { cityId: city.id, status: 'APPROVED', user: { role: 'SELLER', status: 'ACTIVE' } },
      },
      include: { product: true, seller: true },
      orderBy: [{ partnerPrice: 'asc' }, { sellerId: 'asc' }, { id: 'asc' }],
    });
    const available = new Map(offers.map((offer) => [offer.id, offer.onHandQty - offer.reservedQty]));
    const bySku = new Map<string, typeof offers>();
    for (const offer of offers) {
      const matches = bySku.get(offer.product.sku) ?? [];
      matches.push(offer);
      bySku.set(offer.product.sku, matches);
    }

    const materials: PlannedMaterial[] = [];
    const labor: PlannedMeteredLabor[] = [];
    const tasks: ManagedTask[] = [];
    type ShipmentCost = { seller: (typeof offers)[number]['seller']; gross: bigint; weight: bigint; volume: bigint; bulky: boolean };
    const shipmentCosts = new Map<string, ShipmentCost>();
    let wage = 0n;
    let allowance = 0n;
    for (const { serviceKey, definition, card, supplyMode, work } of scopeItems) {
      tasks.push({
        serviceKey, titleFa: definition.titleFa, supplyMode,
        rateCardId: card.id, rateCardVersion: card.version,
      });
      const factors = [BigInt(card.effortBps), BigInt(card.physicalDifficultyBps),
        BigInt(card.technicalDifficultyBps), ...work.complexityRates.map(rateToBps)];
      const ratedWage = ceilDivide(
        BigInt(card.standardMinutes + work.additionalMinutes) * card.hourlyRate *
          factors.reduce((product, factor) => product * factor, 1n),
        60n * BPS ** BigInt(factors.length),
      );
      wage += (ratedWage > card.minVisitWage ? ratedWage : card.minVisitWage) + work.technicianTravel;
      allowance += card.normalAllowance;

      for (const [index, spec] of work.hardware.entries()) {
        let remaining = spec.quantityCm ?? spec.qty;
        let lot = 0;
        for (const offer of bySku.get(spec.sku) ?? []) {
          if (offer.product.serviceKey !== serviceKey) continue;
          const { product, seller, partnerPrice } = offer;
          const availableQty = available.get(offer.id) ?? 0;
          const usesCentimeters = spec.quantityCm !== undefined;
          if (usesCentimeters && product.unit !== 'METER') {
            throw new InternalServerErrorException('واحد کالای متری معتبر نیست.');
          }
          const allocated = Math.min(remaining, usesCentimeters ? availableQty * 100 : availableQty);
          if (allocated <= 0) continue;
          const qty = usesCentimeters ? meteredStockQty(allocated) : allocated;
          const quantityCm = product.unit === 'METER' ? (usesCentimeters ? allocated : allocated * 100) : undefined;
          if (quantityCm !== undefined && quantityCm > MAX_QUANTITY_CM) {
            throw new BadRequestException('طول کالای متری از محدوده مجاز بیشتر است.');
          }
          available.set(offer.id, availableQty - qty);
          const lineTotal = quantityCm === undefined ? partnerPrice * BigInt(qty) : meteredLineAmount(quantityCm, partnerPrice);
          materials.push({
            lineKey: `${serviceKey}:material:${index}:${++lot}`,
            sku: product.sku, serviceKey, titleFa: product.titleFa, unit: product.unit, qty, quantityCm,
            unitPrice: partnerPrice, lineTotal, sellerOfferId: offer.id, offerVersion: offer.version,
            sellerId: seller.id, requiresSerial: product.unit === 'EACH' && product.requiresSerial,
            bucket: product.unit === 'METER' ? 'METERED' : 'FIXED',
          });
          const leg = shipmentCosts.get(seller.id) ?? { seller, gross: 0n, weight: 0n, volume: 0n, bulky: false };
          leg.gross += lineTotal;
          leg.weight += BigInt(product.weightGrams) * BigInt(qty);
          leg.volume += BigInt(product.volumeCm3) * BigInt(qty);
          leg.bulky ||= product.handlingClass !== 'STANDARD';
          shipmentCosts.set(seller.id, leg);
          remaining -= allocated;
          if (remaining === 0) break;
        }
        if (remaining > 0) throw new ConflictException('موجودی تجهیزات انتخاب‌شده کافی نیست.');
      }

      if (work.meteredLabor && work.meteredLabor.quantityCm > 0 && card.meteredLaborPerMeter > 0n) {
        const { quantityCm, titleFa } = work.meteredLabor;
        labor.push({
          lineKey: `${serviceKey}:metered-labor`, serviceKey, rateCardId: card.id, titleFa,
          qty: meteredStockQty(quantityCm), quantityCm,
          unit: 'METER', unitPrice: card.meteredLaborPerMeter,
          lineTotal: meteredLineAmount(quantityCm, card.meteredLaborPerMeter),
        });
      }
    }

    const shipments: ManagedSplit['shipments'] = [...shipmentCosts.values()].map((leg) => {
      const delivery = classifyShipment(policy.delivery, leg);
      const fee = leg.seller.sellerAppFeeFlat;
      if (fee < 0n) throw new InternalServerErrorException('هزینه خدمات تأمین‌کننده نامعتبر است.');
      const ownAppFee = fee > leg.gross ? leg.gross : fee;
      return {
        sellerId: leg.seller.id, sellerUserId: leg.seller.userId, deliveryMode: delivery.deliveryMode,
        freightCost: dynamic(delivery.freightCost),
        grossGoods: leg.gross, ownAppFee, netReceivable: leg.gross - ownAppFee,
      };
    });
    const freight = shipments.reduce((sum, leg) => sum + leg.freightCost, 0n);
    const servicePackage = computeServicePackage(dynamic(wage), freight, allowance, commissionBps, BigInt(bundleBps), sliderBps);
    const fixed = materials.filter((line) => line.bucket === 'FIXED');
    const metered = [...materials.filter((line) => line.bucket === 'METERED'), ...labor];
    const subtotal = (lines: InvoiceLine[]) => lines.reduce((sum, line) => sum + line.lineTotal, 0n);
    const packageLine: InvoiceLine = {
      lineKey: 'service-package', titleFa: policy.packageTitleFa, unit: 'EACH', qty: 1,
      unitPrice: servicePackage.price, lineTotal: servicePackage.price,
    };
    const invoice: ManagedInvoice = {
      buckets: [
        { bucket: 'FIXED', titleFa: policy.fixedTitleFa, badgeFa: policy.fixedBadgeFa, subtotal: subtotal(fixed), lines: fixed.map(invoiceLine) },
        { bucket: 'SERVICE_PACKAGE', titleFa: policy.packageTitleFa, subtotal: servicePackage.price, lines: [packageLine] },
        { bucket: 'METERED', titleFa: policy.meteredTitleFa, subtotal: subtotal(metered), lines: metered.map(invoiceLine) },
      ],
      total: subtotal(fixed) + servicePackage.price + subtotal(metered),
    };
    const internalSplit: ManagedSplit = {
      servicePackage, shipments, meteredLabor: subtotal(labor), total: invoice.total,
    };
    const customerView: PricingEstimateResult = {
      currency: 'TOMAN', invoice, estimatedMin: invoice.total, estimatedMax: invoice.total,
      netEstimated: invoice.total,
      slider: toSliderView(servicePackage, dispatchPriorityPolicy(dispatchRow?.value).priorityThresholdBps),
      summary: { totalHardware: subtotal(fixed), bundleDiscountPercent: bundleBps / 100 },
      factors: {
        surge: { multiplier: surge.multiplier, reasonFa: surge.reasonFa },
        urgency: { urgency: urgency.urgency, multiplier: urgency.multiplier },
      },
    };
    return { customerView, internalSplit, materials, labor, tasks, bundleBps, policyVersion: policy.version, packageLine };
  }
}
