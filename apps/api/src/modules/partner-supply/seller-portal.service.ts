import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import { B2BSupplyService } from './b2b-supply.service';
import { parseB2BLines } from './b2b-supply-lines';
import type { CreateSellerOfferDto, UpdateSellerOfferDto } from './dto/seller-portal.dto';
import { updateManagedFulfillmentStatus } from './managed-fulfillment-status';

const productSelect = {
  id: true, sku: true, titleFa: true, unit: true, weightGrams: true,
  volumeCm3: true, handlingClass: true, requiresSerial: true,
} as const satisfies Prisma.ProductSelect;

const offerInclude = { product: { select: productSelect } } as const satisfies Prisma.SellerOfferInclude;
type Offer = Prisma.SellerOfferGetPayload<{ include: typeof offerInclude }>;

const fulfillmentInclude = {
  b2bSupplyOrder: { select: { orderNumber: true, deliveryAddressFa: true, linesJson: true, escrowPosition: { select: { status: true } } } },
  order: { select: {
    orderNumber: true, activeRevision: true, escrowPosition: { select: { status: true } },
    priceRevisions: { select: { id: true, revision: true, internalSplitJson: true } },
  } },
  lines: { orderBy: { lineKey: 'asc' } },
} as const satisfies Prisma.SupplyFulfillmentInclude;
type Fulfillment = Prisma.SupplyFulfillmentGetPayload<{ include: typeof fulfillmentInclude }>;

const sellerFees = z.object({ shipments: z.array(z.object({
  sellerId: z.string(), ownAppFee: z.string().regex(/^\d+$/).transform(BigInt),
})) });

function partnerPrice(value: string) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value)) {
    throw new BadRequestException('قیمت همکار را به‌صورت عدد صحیح تومان وارد کنید.');
  }
  const amount = BigInt(value);
  if (amount > 9_223_372_036_854_775_807n) throw new BadRequestException('قیمت همکار از محدوده مجاز بیشتر است.');
  return amount;
}

function offerView({ id, sellerSku, productId, product, onHandQty, reservedQty, partnerPrice, isActive, version }: Offer) {
  return { id, sellerSku, productId, product, onHandQty, reservedQty, availableQty: onHandQty - reservedQty, partnerPrice, isActive, version };
}

function sellerFulfillmentView(shipment: Fulfillment) {
  const { id: fulfillmentId, deliveryMode, status, b2bSupplyOrder, order, sellerId } = shipment;
  const identity = { fulfillmentId, deliveryMode, status };
  if (b2bSupplyOrder) {
    const lines = parseB2BLines(b2bSupplyOrder.linesJson).filter((line) => line.sellerId === sellerId)
      .map(({ lineKey, sku, titleFa, unit, qty, partnerUnitPrice, lineTotal }) => ({ lineKey, sku, titleFa, unit, qty, partnerUnitPrice, lineTotal }));
    const grossGoods = lines.reduce((total, line) => total + line.lineTotal, 0n);
    const ownAppFee = shipment.sellerAppFee ?? 0n;
    return {
      ...identity, orderKind: 'B2B' as const, orderNumber: b2bSupplyOrder.orderNumber,
      deliveryAddressFa: b2bSupplyOrder.deliveryAddressFa, lines, grossGoods, ownAppFee,
      netReceivable: grossGoods - ownAppFee, settlementStatus: b2bSupplyOrder.escrowPosition?.status ?? null,
    };
  }

  const revision = order?.priceRevisions.find((row) => row.revision === order.activeRevision);
  if (!order || !revision) throw new InternalServerErrorException('نسخه فعال مرسوله یافت نشد.');
  const fees = sellerFees.safeParse(revision.internalSplitJson);
  const ownAppFee = fees.success ? fees.data.shipments.find((row) => row.sellerId === sellerId)?.ownAppFee : undefined;
  if (ownAppFee === undefined) throw new InternalServerErrorException('داده تسویه مرسوله کامل نیست.');
  const lines = shipment.lines.filter((line) => line.revisionId === revision.id)
    .map(({ lineKey, sku, titleFa, unit, qty, quantityCm, unitPrice, lineTotal }) => ({
      lineKey, sku, titleFa, unit, qty, quantityCm, partnerUnitPrice: unitPrice, lineTotal,
    }));
  const grossGoods = lines.reduce((total, line) => total + line.lineTotal, 0n);
  return {
    ...identity, orderKind: 'B2C' as const, orderNumber: order.orderNumber, lines, grossGoods, ownAppFee,
    netReceivable: grossGoods - ownAppFee, settlementStatus: order.escrowPosition?.status ?? null,
  };
}

@Injectable()
export class SellerPortalService {
  constructor(private readonly prisma: PrismaService, private readonly b2b: B2BSupplyService) {}

  async profile(actor: AuthenticatedUser) {
    if (actor.role !== 'SELLER') throw new ForbiddenException();
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { userId: actor.id },
      select: {
        id: true, shopNameFa: true, phone: true, status: true, addressFa: true, sellerAppFeeFlat: true,
        city: { select: { id: true, nameFa: true } }, branch: { select: { id: true, nameFa: true } },
      },
    });
    if (!profile) throw new NotFoundException('پروفایل فروشنده یافت نشد.');
    return profile;
  }

  async products(actor: AuthenticatedUser) {
    await this.sellerId(actor);
    return this.prisma.product.findMany({ where: { isActive: true }, select: productSelect, orderBy: { sku: 'asc' } });
  }

  async offers(actor: AuthenticatedUser) {
    const sellerId = await this.sellerId(actor);
    const offers = await this.prisma.sellerOffer.findMany({ where: { sellerId }, include: offerInclude, orderBy: { sellerSku: 'asc' } });
    return offers.map(offerView);
  }

  async createOffer(actor: AuthenticatedUser, dto: CreateSellerOfferDto) {
    const sellerId = await this.sellerId(actor);
    const sellerSku = dto.sellerSku.trim();
    if (!sellerSku) throw new BadRequestException('شناسه فروشنده برای کالا را وارد کنید.');
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, isActive: true }, select: { id: true } });
    if (!product) throw new NotFoundException('کالای فعال یافت نشد.');
    const offer = await this.prisma.sellerOffer.create({
      data: { sellerId, productId: product.id, sellerSku, onHandQty: dto.onHandQty, partnerPrice: partnerPrice(dto.partnerPrice), isActive: dto.isActive },
      include: offerInclude,
    });
    return offerView(offer);
  }

  async updateOffer(actor: AuthenticatedUser, id: string, dto: UpdateSellerOfferDto) {
    const sellerId = await this.sellerId(actor);
    const scope = { id, sellerId };
    const current = await this.prisma.sellerOffer.findFirst({ where: scope, select: { version: true } });
    if (!current) throw new NotFoundException('پیشنهاد کالا یافت نشد.');
    if (current.version !== dto.version) throw new ConflictException('پیشنهاد کالا تغییر کرده است. اطلاعات را به‌روز کنید.');
    if (dto.onHandQty === undefined && dto.partnerPrice === undefined && dto.isActive === undefined) {
      throw new BadRequestException('حداقل یکی از قیمت، موجودی یا وضعیت پیشنهاد را وارد کنید.');
    }
    const [offer] = await this.prisma.sellerOffer.updateManyAndReturn({
      where: { ...scope, version: dto.version, reservedQty: dto.onHandQty === undefined ? undefined : { lte: dto.onHandQty } },
      data: {
        partnerPrice: dto.partnerPrice === undefined ? undefined : partnerPrice(dto.partnerPrice),
        onHandQty: dto.onHandQty, isActive: dto.isActive, version: { increment: 1 },
      },
      include: offerInclude,
    });
    if (!offer) throw new ConflictException('نسخه پیشنهاد یا موجودی رزروشده تغییر کرده است. اطلاعات را به‌روز کنید.');
    return offerView(offer);
  }

  async fulfillments(actor: AuthenticatedUser) {
    const sellerId = await this.sellerId(actor);
    const shipments = await this.prisma.supplyFulfillment.findMany({
      where: { sellerId }, include: fulfillmentInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return shipments.map(sellerFulfillmentView);
  }

  async dispatch(actor: AuthenticatedUser, fulfillmentId: string) {
    const sellerId = await this.sellerId(actor);
    const shipment = await this.prisma.supplyFulfillment.findFirst({ where: { id: fulfillmentId, sellerId }, select: { b2bSupplyOrderId: true } });
    if (!shipment) throw new NotFoundException('مرسوله یافت نشد.');
    return shipment.b2bSupplyOrderId
      ? this.b2b.dispatchFulfillment(actor, fulfillmentId)
      : updateManagedFulfillmentStatus(this.prisma, actor, fulfillmentId, 'DISPATCHED');
  }

  private async sellerId(actor: AuthenticatedUser) {
    if (actor.role !== 'SELLER') throw new ForbiddenException();
    const seller = await this.prisma.sellerProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (!seller) throw new NotFoundException('پروفایل فروشنده یافت نشد.');
    return seller.id;
  }
}
