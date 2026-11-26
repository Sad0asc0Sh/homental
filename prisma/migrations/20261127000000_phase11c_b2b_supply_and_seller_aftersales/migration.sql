-- CreateEnum
CREATE TYPE "B2BSupplyOrderStatus" AS ENUM ('FUNDED_RESERVED', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierCaseType" AS ENUM ('UNUSED_RETURN', 'EXCHANGE', 'REPAIR', 'TECH_GUIDANCE');

-- CreateEnum
CREATE TYPE "SupplierCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'APPROVED', 'INSPECTED_ACCEPTED', 'REJECTED', 'RESOLVED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "SupplyFulfillment" DROP CONSTRAINT "SupplyFulfillment_orderId_fkey";

-- DropForeignKey
ALTER TABLE "EscrowPosition" DROP CONSTRAINT "EscrowPosition_orderId_fkey";

-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN     "b2bSupplyOrderId" UUID;

-- AlterTable
ALTER TABLE "SupplyFulfillment" ADD COLUMN     "b2bSupplyOrderId" UUID,
ADD COLUMN     "sellerAppFee" BIGINT;

-- AlterTable
ALTER TABLE "EscrowPosition" ADD COLUMN     "b2bSupplyOrderId" UUID;

-- CreateTable
CREATE TABLE "B2BSupplyOrder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderNumber" TEXT NOT NULL,
    "technicianUserId" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "deliveryAddressFa" TEXT NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(10,6) NOT NULL,
    "status" "B2BSupplyOrderStatus" NOT NULL DEFAULT 'FUNDED_RESERVED',
    "goodsTotal" BIGINT NOT NULL,
    "freightTotal" BIGINT NOT NULL,
    "grandTotal" BIGINT NOT NULL,
    "linesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "B2BSupplyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCase" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "caseNumber" TEXT NOT NULL,
    "type" "SupplierCaseType" NOT NULL,
    "status" "SupplierCaseStatus" NOT NULL DEFAULT 'OPEN',
    "technicianUserId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "fulfillmentId" UUID,
    "b2bSupplyOrderId" UUID,
    "serviceOrderId" UUID,
    "lineKey" TEXT,
    "sku" TEXT,
    "serialNumber" TEXT,
    "requestedQty" INTEGER,
    "approvedQty" INTEGER,
    "replacementOfferId" UUID,
    "priceDelta" BIGINT,
    "sealIntact" BOOLEAN,
    "reasonFa" TEXT NOT NULL,
    "inspectionNoteFa" TEXT,
    "messagesJson" JSONB,
    "refundAmount" BIGINT,
    "idempotencyKey" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "B2BSupplyOrder_orderNumber_key" ON "B2BSupplyOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "B2BSupplyOrder_technicianUserId_createdAt_idx" ON "B2BSupplyOrder"("technicianUserId", "createdAt");

-- CreateIndex
CREATE INDEX "B2BSupplyOrder_cityId_createdAt_idx" ON "B2BSupplyOrder"("cityId", "createdAt");

-- CreateIndex
CREATE INDEX "B2BSupplyOrder_branchId_createdAt_idx" ON "B2BSupplyOrder"("branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCase_caseNumber_key" ON "SupplierCase"("caseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCase_idempotencyKey_key" ON "SupplierCase"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplierCase_technicianUserId_createdAt_idx" ON "SupplierCase"("technicianUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierCase_sellerId_createdAt_idx" ON "SupplierCase"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierCase_fulfillmentId_lineKey_status_idx" ON "SupplierCase"("fulfillmentId", "lineKey", "status");

-- CreateIndex
CREATE INDEX "WalletTransaction_b2bSupplyOrderId_idx" ON "WalletTransaction"("b2bSupplyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyFulfillment_b2bSupplyOrderId_sellerId_key" ON "SupplyFulfillment"("b2bSupplyOrderId", "sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowPosition_b2bSupplyOrderId_key" ON "EscrowPosition"("b2bSupplyOrderId");

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_b2bSupplyOrderId_fkey" FOREIGN KEY ("b2bSupplyOrderId") REFERENCES "B2BSupplyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "B2BSupplyOrder" ADD CONSTRAINT "B2BSupplyOrder_technicianUserId_fkey" FOREIGN KEY ("technicianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "B2BSupplyOrder" ADD CONSTRAINT "B2BSupplyOrder_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "B2BSupplyOrder" ADD CONSTRAINT "B2BSupplyOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCase" ADD CONSTRAINT "SupplierCase_technicianUserId_fkey" FOREIGN KEY ("technicianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCase" ADD CONSTRAINT "SupplierCase_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCase" ADD CONSTRAINT "SupplierCase_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "SupplyFulfillment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCase" ADD CONSTRAINT "SupplierCase_b2bSupplyOrderId_fkey" FOREIGN KEY ("b2bSupplyOrderId") REFERENCES "B2BSupplyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCase" ADD CONSTRAINT "SupplierCase_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyFulfillment" ADD CONSTRAINT "SupplyFulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyFulfillment" ADD CONSTRAINT "SupplyFulfillment_b2bSupplyOrderId_fkey" FOREIGN KEY ("b2bSupplyOrderId") REFERENCES "B2BSupplyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowPosition" ADD CONSTRAINT "EscrowPosition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowPosition" ADD CONSTRAINT "EscrowPosition_b2bSupplyOrderId_fkey" FOREIGN KEY ("b2bSupplyOrderId") REFERENCES "B2BSupplyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplyFulfillment" ADD CONSTRAINT "SupplyFulfillment_exactly_one_parent" CHECK (
  (("orderId" IS NOT NULL)::int + ("b2bSupplyOrderId" IS NOT NULL)::int) = 1
);

ALTER TABLE "EscrowPosition" ADD CONSTRAINT "EscrowPosition_exactly_one_parent" CHECK (
  (("orderId" IS NOT NULL)::int + ("b2bSupplyOrderId" IS NOT NULL)::int) = 1
);

ALTER TABLE "B2BSupplyOrder" ADD CONSTRAINT "B2BSupplyOrder_total_matches_components" CHECK (
  "goodsTotal" >= 0 AND "freightTotal" >= 0 AND "grandTotal" = "goodsTotal"::numeric + "freightTotal"
);

ALTER TABLE "SupplyFulfillment" ADD CONSTRAINT "SupplyFulfillment_nonnegative_seller_fee" CHECK ("sellerAppFee" >= 0);
