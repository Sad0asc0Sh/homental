import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type { DeliveryMode, InvoiceBucket, ProductUnit, ServiceKey, SupplyMode } from '@prisma/client';
import { BPS, ceilDivide } from '@common/utils/basis-points.util';

export const MANAGED_PRICING_VERSION = 2;
export const MANAGED_RESERVE_BPS = 500n;
export const MIN_DELTA_BPS = -1500;
export const MAX_DELTA_BPS = 2500;
export const SLIDER_STEP_BPS = 100;

export function validateSliderBps(sliderBps: number, minDeltaBps = MIN_DELTA_BPS): void {
  if (!Number.isInteger(sliderBps) || sliderBps % SLIDER_STEP_BPS !== 0 ||
      sliderBps < minDeltaBps || sliderBps > MAX_DELTA_BPS) {
    const range = new Intl.NumberFormat('fa-IR', { style: 'percent', maximumFractionDigits: 0 });
    throw new BadRequestException(
      `تنظیم بسته باید با گام یک درصد، از ${range.format(minDeltaBps / Number(BPS))} تا ${range.format(MAX_DELTA_BPS / Number(BPS))} باشد.`,
    );
  }
}

export function computeServicePackage(
  wage: bigint,
  freight: bigint,
  allowance: bigint,
  commissionBps: bigint,
  bundleBps: bigint,
  sliderBps = 0,
) {
  const cost = wage + freight + allowance;
  const denominator = BPS - commissionBps - MANAGED_RESERVE_BPS;
  if (cost <= 0n || denominator <= 0n) {
    throw new InternalServerErrorException('تعرفه بسته خدمت نامعتبر است.');
  }
  const reserveOn = (amount: bigint) => MANAGED_RESERVE_BPS * amount / BPS;
  const protectedFloor = ceilDivide(cost * BPS, denominator);
  const minimumMargin = protectedFloor - cost - reserveOn(protectedFloor);
  const anchor = ceilDivide(
    (cost + minimumMargin + protectedFloor / 4n) * BPS,
    BPS - MANAGED_RESERVE_BPS,
  );
  const basePrice = anchor - anchor * bundleBps / BPS;
  const floorDelta = ceilDivide(protectedFloor * BPS, basePrice) - BPS;
  const rawMinBps = floorDelta < BigInt(MIN_DELTA_BPS) ? BigInt(MIN_DELTA_BPS) : floorDelta;
  const minDeltaBps = Number(ceilDivide(rawMinBps, 500n) * 500n);
  validateSliderBps(sliderBps, minDeltaBps);
  const price = basePrice * (BPS + BigInt(sliderBps)) / BPS;
  const reserve = reserveOn(price);
  const surplus = price - reserve - cost - minimumMargin;
  const technicianBonus = 5000n * surplus / BPS;
  const technicianPackageNet = wage + technicianBonus;
  const commission = minimumMargin + surplus - technicianBonus;
  if (price < protectedFloor || surplus < 0n || minimumMargin < 0n ||
      price !== technicianPackageNet + commission + reserve + freight + allowance) {
    throw new InternalServerErrorException('تراز بسته خدمت نامعتبر است.');
  }
  return {
    price, commissionBps: Number(commissionBps), commission, reserve, wage, freight, allowance,
    protectedFloor, minimumMargin, anchor, surplus, technicianPackageNet,
    basePrice, sliderBps, minDeltaBps, maxDeltaBps: MAX_DELTA_BPS,
  };
}

export function toSliderView(servicePackage: ReturnType<typeof computeServicePackage>, priorityThresholdBps: number) {
  const { sliderBps, minDeltaBps, maxDeltaBps, basePrice } = servicePackage;
  return {
    sliderBps, minDeltaBps, maxDeltaBps, priorityThresholdBps, packageBaseAmount: basePrice,
    dispatchAudience: sliderBps >= priorityThresholdBps ? 'TOP' as const : 'ALL' as const,
  };
}

export interface InvoiceLine {
  lineKey: string;
  sku?: string;
  titleFa: string;
  unit: ProductUnit;
  qty: number;
  quantityCm?: number;
  unitPrice: bigint;
  lineTotal: bigint;
}

export interface ManagedInvoice {
  buckets: {
    bucket: InvoiceBucket;
    titleFa: string;
    badgeFa?: string;
    subtotal: bigint;
    lines: InvoiceLine[];
  }[];
  total: bigint;
}

export interface ManagedTask {
  serviceKey: ServiceKey;
  titleFa: string;
  supplyMode: SupplyMode;
  rateCardId: string;
  rateCardVersion: number;
}

export interface PlannedMaterial extends InvoiceLine {
  bucket: 'FIXED' | 'METERED';
  serviceKey: ServiceKey;
  sku: string;
  sellerOfferId: string;
  offerVersion: number;
  sellerId: string;
  requiresSerial: boolean;
}

export interface PlannedMeteredLabor extends InvoiceLine {
  serviceKey: ServiceKey;
  rateCardId: string;
}

export interface PlannedShipment {
  sellerId: string;
  sellerUserId: string;
  deliveryMode: DeliveryMode;
  freightCost: bigint;
  grossGoods: bigint;
  ownAppFee: bigint;
  netReceivable: bigint;
}

export interface ManagedSplit {
  servicePackage: ReturnType<typeof computeServicePackage>;
  shipments: PlannedShipment[];
  meteredLabor: bigint;
  total: bigint;
}
