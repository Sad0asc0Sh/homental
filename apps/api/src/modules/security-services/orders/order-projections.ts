import { ForbiddenException } from '@nestjs/common';
import type { Prisma, UserRole } from '@prisma/client';
import { managedSerialLineKeys, parseManagedSplit } from './managed-order-economics';
import { meteredLineCm, toMeteredAdjustmentView, toTechnicianMeteredAdjustmentView } from './metered-adjustment-view';

export const ORDER_PROJECTION_INCLUDE = {
  items: {
    include: {
      serviceDefinition: { select: { key: true, titleFa: true } },
      hardwareUnits: { select: { orderAddonId: true, serialNumber: true } },
    },
  },
  address: { select: { titleFa: true, fullAddressFa: true } },
  property: {
    select: {
      id: true,
      title: true,
      propertyType: true,
      address: true,
      lat: true,
      lng: true,
      notes: true,
      defaultDimensionsJson: true,
      mediaAssets: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          propertyId: true,
          kind: true,
          status: true,
          storageKey: true,
          mimeType: true,
          sizeBytes: true,
          publicUrl: true,
          spatialMetadataJson: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  },
  priceRevisions: { include: { addons: { orderBy: { lineKey: 'asc' } } } },
  escrowPosition: { select: { status: true } },
  meteredAdjustments: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
} as const satisfies Prisma.ServiceOrderInclude;

export const SELLER_FULFILLMENT_INCLUDE = {
  lines: { orderBy: { lineKey: 'asc' } },
  order: {
    select: {
      activeRevision: true,
      priceRevisions: { select: { id: true, revision: true, internalSplitJson: true } },
      escrowPosition: { select: { status: true } },
    },
  },
} as const satisfies Prisma.SupplyFulfillmentInclude;

type ProjectedOrder = Prisma.ServiceOrderGetPayload<{ include: typeof ORDER_PROJECTION_INCLUDE }>;
type SellerFulfillment = Prisma.SupplyFulfillmentGetPayload<{ include: typeof SELLER_FULFILLMENT_INCLUDE }>;
type DetailedOrder = ProjectedOrder & Partial<Prisma.ServiceOrderGetPayload<{
  include: { stateTransitions: true; review: true; transactions: true };
}>>;

function orderHeader(order: ProjectedOrder) {
  const { id, state, orderNumber, pricingVersion, activeRevision, locationType, urgency, supplyMode, scheduledAt,
    createdAt, updatedAt, completedAt, cancelledAt } = order;
  return {
    id, state, orderNumber, pricingVersion, activeRevision, locationType, urgency, supplyMode, scheduledAt,
    createdAt, updatedAt, completedAt, cancelledAt,
  };
}

function orderItems(order: ProjectedOrder) {
  return order.items.map((item) => ({
    id: item.id,
    supplyMode: item.supplyMode ?? order.supplyMode,
    serviceDefinition: { key: item.serviceDefinition.key, titleFa: item.serviceDefinition.titleFa },
  }));
}

function activeRevision(order: ProjectedOrder) {
  return order.priceRevisions?.find((revision) => revision.revision === order.activeRevision);
}

function latestMeteredAdjustment(order: ProjectedOrder) {
  const latest = order.meteredAdjustments?.[0];
  const base = latest && order.priceRevisions.find(({ revision }) => revision === latest.baseRevision);
  return latest && base ? toMeteredAdjustmentView(latest, base.addons) : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function moneyString(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : undefined;
}

function customerSlider(snapshot: unknown) {
  const { sliderBps, minDeltaBps, maxDeltaBps, priorityThresholdBps, dispatchAudience, packageBaseAmount } =
    asRecord(asRecord(snapshot).slider);
  const baseAmount = moneyString(packageBaseAmount);
  if (typeof sliderBps !== 'number' || typeof minDeltaBps !== 'number' || typeof maxDeltaBps !== 'number' ||
      typeof priorityThresholdBps !== 'number' || (dispatchAudience !== 'TOP' && dispatchAudience !== 'ALL') || !baseAmount) {
    return null;
  }
  return { sliderBps, minDeltaBps, maxDeltaBps, priorityThresholdBps, dispatchAudience, packageBaseAmount: baseAmount };
}

export function guaranteedPackageNet(terms: unknown): string | null {
  return moneyString(asRecord(terms).agreedPackageNet) ?? null;
}

function toPropertySummary(property: ProjectedOrder['property'] | null | undefined) {
  if (!property) return null;
  const mediaAssets = property.mediaAssets ?? [];
  return {
    id: property.id,
    title: property.title,
    propertyType: property.propertyType,
    address: property.address,
    lat: property.lat,
    lng: property.lng,
    notes: property.notes,
    defaultDimensionsJson: property.defaultDimensionsJson,
    mediaCount: mediaAssets.length,
    hasReady3dModel: mediaAssets.some(
      (asset) => asset.kind === 'MODEL_3D_GLB' && asset.status === 'READY',
    ),
    mediaAssets,
  };
}

export function toCustomerOrderView(order: DetailedOrder) {
  const revision = activeRevision(order);
  const latestAdjustment = latestMeteredAdjustment(order);
  const legacy = asRecord(order.pricing);
  const snapshotBuckets = asRecord(asRecord(revision?.customerViewJson).invoice).buckets;
  const invoice = revision ? {
    total: revision.addons.reduce((sum, line) => sum + line.lineTotal, 0n),
    buckets: (['FIXED', 'SERVICE_PACKAGE', 'METERED'] as const).map((bucket) => {
      const labels = (Array.isArray(snapshotBuckets) ? snapshotBuckets : [])
        .map(asRecord).find((value) => value.bucket === bucket);
      const addons = revision.addons.filter((line) => line.bucket === bucket);
      return {
        bucket,
        titleFa: typeof labels?.titleFa === 'string' ? labels.titleFa : '',
        badgeFa: typeof labels?.badgeFa === 'string' ? labels.badgeFa : undefined,
        subtotal: addons.reduce((sum, line) => sum + line.lineTotal, 0n),
        lines: addons.map(({ lineKey, sku, titleFa, unit, qty, unitPrice, lineTotal, quantityCm }) => ({
          lineKey, sku, titleFa, unit, qty, unitPrice, lineTotal, quantityCm: quantityCm ?? undefined,
        })),
      };
    }),
  } : null;
  return {
    ...orderHeader(order),
    propertyId: order.propertyId ?? null,
    propertySummary: toPropertySummary(order.property),
    technicianId: order.technicianId,
    finalQuoteAmount: order.finalQuoteAmount,
    escrowStatus: order.escrowPosition?.status ?? null,
    invoice,
    slider: customerSlider(revision?.customerViewJson),
    latestAdjustment,
    pendingAdjustment: latestAdjustment?.status === 'PENDING_APPROVAL' ? latestAdjustment : null,
    pricing: invoice ? { netEstimated: invoice.total } : {
      netEstimated: moneyString(legacy.netEstimated),
      estimatedMin: moneyString(legacy.estimatedMin),
      estimatedMax: moneyString(legacy.estimatedMax),
    },
    items: orderItems(order),
    stateTransitions: order.stateTransitions?.map(({ id, fromState, toState, reason, createdAt }) => ({
      id, fromState, toState, reason, createdAt,
    })),
    review: order.review ? { id: order.review.id, rating: order.review.rating, commentFa: order.review.commentFa } : null,
  };
}

export function toTechnicianOrderView(order: ProjectedOrder) {
  const revision = activeRevision(order);
  const adjustment = latestMeteredAdjustment(order);
  const latestAdjustment = adjustment ? toTechnicianMeteredAdjustmentView(adjustment) : null;
  const terms = asRecord(revision?.technicianTermsJson);
  const agreedPackageNet = guaranteedPackageNet(terms);
  const meteredLabor = BigInt(moneyString(terms.meteredLabor) ?? '0');
  const materials = (revision?.addons ?? []).filter(({ kind }) => kind === 'MATERIAL').map(
    ({ id, lineKey, orderItemId, sku, titleFa, unit, qty, quantityCm }) =>
      ({ id, lineKey, orderItemId, sku, titleFa, unit, qty, quantityCm: quantityCm ?? undefined }),
  );
  const serialLineKeys = revision ? managedSerialLineKeys(revision) : new Set<string>();
  const serialsRequired = materials.filter((line) => serialLineKeys.has(line.lineKey)).map(({ id, orderItemId, sku, titleFa, qty }) => ({
    orderAddonId: id, orderItemId, sku, titleFa, qty,
    registeredQty: order.items.find((item) => item.id === orderItemId)?.hardwareUnits.filter((unit) => unit.orderAddonId === id).length ?? 0,
  }));
  const taskTerms = Array.isArray(terms.tasks) ? terms.tasks.map(asRecord) : [];
  return {
    ...orderHeader(order),
    propertyId: order.propertyId ?? null,
    propertySummary: toPropertySummary(order.property),
    address: order.address ? { titleFa: order.address.titleFa, fullAddressFa: order.address.fullAddressFa } : null,
    tasks: orderItems(order).map(({ id, supplyMode, serviceDefinition }) => {
      const details = taskTerms.find((task) => task.serviceKey === serviceDefinition.key)?.details;
      return {
        orderItemId: id, supplyMode, serviceKey: serviceDefinition.key, titleFa: serviceDefinition.titleFa,
        details: (Array.isArray(details) ? details : []).map(asRecord).flatMap(({ labelFa, value }) =>
          typeof labelFa === 'string' && ['string', 'number', 'boolean'].includes(typeof value)
            ? [{ labelFa, value }] : []),
      };
    }),
    materials,
    agreedPackageNet,
    meteredLines: (revision?.addons ?? []).filter(({ bucket }) => bucket === 'METERED')
      .map((line) => ({ lineKey: line.lineKey, titleFa: line.titleFa, estimatedCm: meteredLineCm(line) })),
    latestAdjustment,
    pendingAdjustment: latestAdjustment?.status === 'PENDING_APPROVAL' ? latestAdjustment : null,
    meteredLabor,
    estimatedNet: agreedPackageNet === null ? null : BigInt(agreedPackageNet) + meteredLabor,
    serialsRequired,
    checklistStatus: order.privacyChecklistSignedAt ? 'SIGNED' : 'PENDING',
    handoverStatus: order.state === 'COMPLETED_WARRANTY_ACTIVE' ? 'COMPLETED' :
      order.state === 'HANDOVER_OTP_PENDING' ? 'OTP_PENDING' : 'PENDING',
  };
}

export function toBranchOrderView(order: ProjectedOrder) {
  return {
    ...orderHeader(order),
    propertyId: order.propertyId ?? null,
    propertySummary: toPropertySummary(order.property),
    branchId: order.branchId,
    technicianId: order.technicianId,
    items: orderItems(order),
  };
}

export function toSellerOrderView(fulfillment: SellerFulfillment) {
  const revision = fulfillment.order?.priceRevisions.find(({ revision }) => revision === fulfillment.order?.activeRevision);
  const shipment = revision && parseManagedSplit(revision.internalSplitJson).shipments.find(
    ({ sellerId }) => sellerId === fulfillment.sellerId,
  );
  const lines = fulfillment.lines.filter((line) => line.revisionId === revision?.id)
    .map(({ sku, titleFa, unit, qty, unitPrice, lineTotal, quantityCm }) => ({
      sku, titleFa, unit, qty, partnerUnitPrice: unitPrice, lineTotal, quantityCm: quantityCm ?? undefined,
    }));
  const grossGoods = lines.reduce((sum, line) => sum + line.lineTotal, 0n);
  const ownAppFee = shipment?.ownAppFee ?? 0n;
  return {
    fulfillmentId: fulfillment.id,
    deliveryMode: fulfillment.deliveryMode,
    lines,
    grossGoods,
    ownAppFee,
    netReceivable: grossGoods - ownAppFee,
    settlementStatus: fulfillment.order?.escrowPosition?.status ?? null,
  };
}

export function toAdminFinanceView(role: UserRole, order: DetailedOrder) {
  if (role !== 'SUPER_ADMIN') throw new ForbiddenException();
  const revision = activeRevision(order);
  return {
    ...toCustomerOrderView(order),
    branchId: order.branchId,
    customerId: order.customerId,
    internalSplitJson: revision?.internalSplitJson ?? null,
    ledger: order.transactions ?? [],
  };
}
