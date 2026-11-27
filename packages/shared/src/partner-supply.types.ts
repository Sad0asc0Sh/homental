export type DeliveryMode = 'BIKE' | 'CAR';
export type FulfillmentStatus = 'RESERVED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
export type B2BSupplyStatus = 'FUNDED_RESERVED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
export type ProductUnit = 'EACH' | 'METER';

export interface SupplyProduct {
  id: string;
  sku: string;
  titleFa: string;
  unit: ProductUnit;
  requiresSerial: boolean;
  weightGrams: number;
  volumeCm3: number;
  handlingClass: string;
  specs?: unknown;
}

export interface CatalogOffer {
  id: string;
  sellerId: string;
  sellerSku: string;
  partnerPrice: string;
  availableQty: number;
  version: number;
  seller: { id: string; shopNameFa: string };
  product: SupplyProduct;
}

export interface SupplyCatalog {
  items: CatalogOffer[];
  deliveryPolicy: { bikeMaxGrams: number; bikeMaxCm3: number; bikeToman: string; carToman: string };
}

export interface B2BSupplyInput {
  deliveryAddressFa: string;
  lat: number;
  lng: number;
  items: Array<{ sellerOfferId: string; qty: number }>;
}

export interface SupplyLine {
  lineKey: string;
  sku: string | null;
  titleFa: string;
  unit: ProductUnit;
  qty: number;
  partnerUnitPrice: string;
  lineTotal: string;
  quantityCm?: number | null;
}

export interface B2BFulfillment {
  id: string;
  sellerId: string;
  shopNameFa: string;
  deliveryMode: DeliveryMode;
  freightCost: string;
  status: FulfillmentStatus;
  lines: Array<SupplyLine & { sellerOfferId: string; sellerId: string }>;
}

export interface B2BSupplyOrder {
  id: string;
  orderNumber: string;
  deliveryAddressFa: string;
  status: B2BSupplyStatus;
  goodsTotal: string;
  freightTotal: string;
  grandTotal: string;
  createdAt: string;
  updatedAt: string;
  fulfillments: B2BFulfillment[];
}

export interface SellerProfileView {
  id: string;
  shopNameFa: string;
  addressFa: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'SUSPENDED';
}

export interface SellerOfferView {
  id: string;
  productId: string;
  sellerSku: string;
  partnerPrice: string;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
  version: number;
  isActive: boolean;
  product: SupplyProduct;
}

export interface CreateSellerOfferInput {
  productId: string;
  sellerSku: string;
  partnerPrice: string;
  onHandQty: number;
  isActive?: boolean;
}

export interface UpdateSellerOfferInput {
  version: number;
  partnerPrice: string;
  onHandQty: number;
  isActive: boolean;
}

export interface SellerShipmentView {
  fulfillmentId: string;
  orderKind: 'B2B' | 'B2C';
  orderNumber: string;
  deliveryAddressFa?: string | null;
  deliveryMode: DeliveryMode;
  status: FulfillmentStatus;
  lines: SupplyLine[];
  grossGoods: string;
  ownAppFee: string;
  netReceivable: string;
  settlementStatus: 'OPEN' | 'SETTLED' | 'REFUNDED' | null;
}

export type SupplierCaseType = 'UNUSED_RETURN' | 'EXCHANGE' | 'REPAIR' | 'TECH_GUIDANCE';
export type SupplierCaseStatus = 'OPEN' | 'IN_REVIEW' | 'APPROVED' | 'INSPECTED_ACCEPTED' | 'REJECTED' | 'RESOLVED' | 'CANCELLED';

export interface SupplierCase {
  id: string;
  caseNumber: string;
  type: SupplierCaseType;
  status: SupplierCaseStatus;
  sellerId: string;
  sellerShopNameFa: string;
  fulfillmentId: string | null;
  b2bSupplyOrderId: string | null;
  serviceOrderId: string | null;
  lineKey: string | null;
  sku: string | null;
  serialNumber: string | null;
  requestedQty: number | null;
  approvedQty: number | null;
  replacementOfferId: string | null;
  priceDelta: string | null;
  sealIntact: boolean | null;
  reasonFa: string;
  inspectionNoteFa: string | null;
  messages: Array<{ senderRole: 'TECHNICIAN' | 'SELLER'; textFa: string; at: string }>;
  refundAmount: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface CreateSupplierCaseInput {
  type: SupplierCaseType;
  sellerId: string;
  reasonFa: string;
  fulfillmentId?: string;
  lineKey?: string;
  requestedQty?: number;
  sku?: string;
  serialNumber?: string;
}

export interface ResolveSupplierCaseInput {
  status: Exclude<SupplierCaseStatus, 'OPEN'>;
  inspectionNoteFa?: string;
  sealIntact?: boolean;
  cutCable?: boolean;
  approvedQty?: number;
  replacementOfferId?: string;
  idempotencyKey?: string;
}
