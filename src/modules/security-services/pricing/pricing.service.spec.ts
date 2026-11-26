import { ServiceKey, SupplyMode, UrgencyLevel } from '@prisma/client';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { pilotProductSku, pilotProducts, pilotRates, pilotSuppliers, platformConfigs, serviceDefinitions } from '../../../../prisma/seed';
import { JsonLogicEvaluator } from '../shared/json-logic.evaluator';
import type { DynamicFactorsService } from './dynamic-factors.service';
import { PricingSchemaInterpreter } from './pricing-schema.interpreter';
import { PricingService } from './pricing.service';

function buildService(surge = 1, urgency = 1) {
  const offers = Object.values(ServiceKey).flatMap((serviceKey) => {
    const seller = { id: serviceKey, userId: pilotSuppliers[serviceKey].phone, sellerAppFeeFlat: 0n };
    return pilotProducts[serviceKey].map(([suffix, titleFa, partnerPrice, requiresSerial = true, weightGrams = 500, volumeCm3 = 1000, unit = 'EACH']) => {
      const sku = pilotProductSku(serviceKey, suffix, unit);
      const handlingClass = weightGrams >= 8000 ? 'BULKY' : 'STANDARD';
      return {
        id: sku, version: 1, onHandQty: 500, reservedQty: 0, partnerPrice, seller,
        product: { sku, serviceKey, titleFa, requiresSerial, weightGrams, volumeCm3, unit, handlingClass },
      };
    });
  });
  const prisma = {
    city: { findFirst: jest.fn().mockResolvedValue({ id: 'mashhad', slug: 'mashhad' }) },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'MSHD-C1', commissionRateOverride: 0.1 }) },
    platformConfig: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(platformConfigs.find(({ key }) => key === where.key))),
    },
    serviceDefinition: { findMany: jest.fn().mockResolvedValue(serviceDefinitions) },
    installationRateCard: {
      findMany: jest.fn().mockResolvedValue(pilotRates.map((rate) => ({
        effortBps: 10_000, physicalDifficultyBps: 10_000, technicalDifficultyBps: 10_000, meteredLaborPerMeter: 0n,
        ...rate, id: `rate-${rate.serviceKey}`, version: 1, cityId: 'mashhad', branchId: 'MSHD-C1',
      }))),
    },
    sellerOffer: { findMany: jest.fn().mockResolvedValue(offers) },
  } as unknown as PrismaService;
  const factors = {
    getSurge: jest.fn().mockResolvedValue({ multiplier: surge, reasonFa: 'تعرفه عادی' }),
    getUrgency: jest.fn().mockResolvedValue({ urgency: UrgencyLevel.SCHEDULED, multiplier: urgency }),
  } as unknown as DynamicFactorsService;
  return new PricingService(prisma, new PricingSchemaInterpreter(new JsonLogicEvaluator()), factors);
}

const cctv = { serviceKey: ServiceKey.CCTV };
const alarm = {
  serviceKey: ServiceKey.ALARM,
  config: { doorSensorCount: 1, windowSensorCount: 0, motionSensorCount: 1 },
};
const shutter = { serviceKey: ServiceKey.ELECTRIC_SHUTTER, config: { widthCm: 300, heightCm: 200 } };
const jack = { serviceKey: ServiceKey.PARKING_JACK };

describe('PricingService — Mashhad pilot rate cards', () => {
  it.each([
    [cctv, 3_120_000n, 110_000n, 'BIKE'],
    [alarm, 3_880_000n, 157_500n, 'BIKE'],
    [shutter, 6_550_000n, 717_500n, 'CAR'],
    [jack, 4_600_000n, 450_000n, 'CAR'],
  ] as const)('calibrates %j to RFC wage, freight and allowance', async (item, wage, costAllocation, deliveryMode) => {
    const { internalSplit } = await buildService().estimateManaged({ items: [item] });
    const { servicePackage, shipments } = internalSplit;
    expect(servicePackage.wage).toBe(wage);
    expect(servicePackage.commissionBps).toBe(1000);
    expect(servicePackage.freight + servicePackage.allowance).toBe(costAllocation);
    expect(shipments).toEqual([expect.objectContaining({ deliveryMode })]);
  });

  it('prices the CCTV package at 4,800,000 Toman over a 3,800,000 protected floor', async () => {
    const { customerView, internalSplit } = await buildService().estimateManaged({ items: [cctv] });
    expect(internalSplit.servicePackage).toMatchObject({ protectedFloor: 3_800_000n, anchor: 4_800_000n, price: 4_800_000n });
    expect(customerView.invoice.buckets).toMatchObject([
      { bucket: 'FIXED', badgeFa: 'تأمین مستقیم به قیمت همکار — ۰٪ اضافه‌قیمت', subtotal: 25_970_000n },
      { bucket: 'SERVICE_PACKAGE', titleFa: 'بسته اجرا، لجستیک، پشتیبانی و ضمانت هومنتال', subtotal: 4_800_000n },
      { bucket: 'METERED', subtotal: 1_200_000n },
    ]);
    expect(customerView.netEstimated).toBe(31_970_000n);
    expect(customerView.invoice.total).toBe(customerView.netEstimated);
  });

  it('matches the two-service floor and applies the 6% discount to the package', async () => {
    const { customerView, internalSplit } = await buildService().estimateManaged({ items: [cctv, alarm] });
    const { servicePackage } = internalSplit;
    expect(servicePackage).toMatchObject({ wage: 7_000_000n, protectedFloor: 8_550_000n, anchor: 10_800_000n, price: 10_152_000n });
    expect(servicePackage.freight + servicePackage.allowance).toBe(267_500n);
    expect(customerView.summary.bundleDiscountPercent).toBe(6);
    expect(internalSplit.shipments.map(({ deliveryMode }) => deliveryMode)).toEqual(['BIKE', 'BIKE']);
  });

  it('prices cut cable and duct to the centimeter at frozen partner and labor rates', async () => {
    const { customerView, materials } = await buildService().estimateManaged({
      items: [{ ...cctv, config: { ductMeters: 2.51 } }, alarm],
    });
    expect(materials.find(({ sku }) => sku === 'DUCT_PVC_20MM')).toMatchObject({
      bucket: 'METERED', unit: 'METER', qty: 3, quantityCm: 251, unitPrice: 18_750n, lineTotal: 47_062n,
    });
    expect(customerView.invoice.buckets.find(({ bucket }) => bucket === 'METERED')?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: 'CABLE_RG59_COMBO', quantityCm: 6000, lineTotal: 870_000n }),
        expect.objectContaining({ sku: 'CABLE_ALARM_2PAIR', quantityCm: 1000, lineTotal: 74_000n }),
        expect.objectContaining({ sku: 'DUCT_PVC_20MM', quantityCm: 251, lineTotal: 47_062n }),
        expect.objectContaining({ lineKey: 'CCTV:metered-labor', quantityCm: 6251, lineTotal: 343_805n }),
        expect.objectContaining({ lineKey: 'ALARM:metered-labor', quantityCm: 1000, lineTotal: 45_000n }),
      ]),
    );
  });

  it('matches the three-service floor, anchor, 10% bundle price and rounded slider floor', async () => {
    const { customerView, internalSplit } = await buildService().estimateManaged({ items: [cctv, alarm, shutter] });
    const { servicePackage, shipments } = internalSplit;
    expect(servicePackage).toMatchObject({
      wage: 13_550_000n, protectedFloor: 17_100_000n, anchor: 21_600_000n, price: 19_440_000n, minDeltaBps: -1000,
    });
    expect(servicePackage.freight + servicePackage.allowance).toBe(985_000n);
    expect(shipments.map(({ deliveryMode }) => deliveryMode)).toEqual(['BIKE', 'BIKE', 'CAR']);
    expect(customerView.summary.bundleDiscountPercent).toBe(10);
    const sliderFloor = servicePackage.price * (10_000n + BigInt(servicePackage.minDeltaBps)) / 10_000n;
    expect(sliderFloor).toBe(17_496_000n);
    expect(sliderFloor).toBeGreaterThan(12_150_000n);
  });

  it('keeps the existing double-arm, hydraulic and high-traffic jack multipliers', async () => {
    const service = buildService();
    const doubleArm = await service.estimateManaged({ items: [{ ...jack, config: { jackType: 'DOUBLE_ARM' } }] });
    const hydraulic = await service.estimateManaged({ items: [{ ...jack, config: { jackType: 'HYDRAULIC', usagePerDay: 31 } }] });
    expect(doubleArm.internalSplit.servicePackage.wage).toBe(5_470_000n);
    expect(hydraulic.internalSplit.servicePackage.wage).toBe(6_470_500n);
  });

  it('applies surge and urgency to wage and freight while preserving partner hardware prices', async () => {
    const items = [alarm];
    const calm = await buildService().estimateManaged({ items });
    const peak = await buildService(1.25, 1.3).estimateManaged({ items });
    expect(peak.customerView.invoice.buckets[0]).toEqual(calm.customerView.invoice.buckets[0]);
    expect(peak.internalSplit.servicePackage).toMatchObject({ wage: 6_305_000n, freight: 146_250n, allowance: 67_500n });
    expect(peak.customerView.netEstimated).toBeGreaterThan(calm.customerView.netEstimated);
  });

  it('keeps the 6% discount for a mixed install-only bundle and includes only the supplied hardware', async () => {
    const mixed = await buildService().estimateManaged({ items: [{ ...cctv, supplyMode: SupplyMode.INSTALL_ONLY }, alarm] });
    expect(mixed.materials.map(({ serviceKey }) => serviceKey)).toEqual(mixed.materials.map(() => ServiceKey.ALARM));
    expect(mixed.materials.length).toBeGreaterThan(0);
    expect(mixed.internalSplit.servicePackage.wage).toBe(7_000_000n);
    expect(mixed.customerView.summary.bundleDiscountPercent).toBe(6);
    expect(mixed.labor).toEqual([
      expect.objectContaining({ serviceKey: 'CCTV', quantityCm: 6000, lineTotal: 330_000n }),
      expect.objectContaining({ serviceKey: 'ALARM', quantityCm: 1000, lineTotal: 45_000n }),
    ]);
  });

  it('rejects duplicate and unknown service keys', async () => {
    const service = buildService();
    await expect(service.estimate({ items: [alarm, alarm] })).rejects.toThrow(/فقط یک بار/);
    await expect(service.estimate({ items: [{ serviceKey: 'GOLD_ALARM' }] })).rejects.toThrow(/در دسترس نیست/);
  });
});
