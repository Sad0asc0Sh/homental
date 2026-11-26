-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProductUnit" AS ENUM ('EACH', 'METER');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('BIKE', 'CAR');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('RESERVED', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PriceRevisionStatus" AS ENUM ('DRAFT', 'FUNDED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceBucket" AS ENUM ('FIXED', 'SERVICE_PACKAGE', 'METERED');

-- CreateEnum
CREATE TYPE "AddonKind" AS ENUM ('MATERIAL', 'LABOR');

-- CreateEnum
CREATE TYPE "EscrowPositionStatus" AS ENUM ('OPEN', 'SETTLED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SELLER';

-- AlterEnum
ALTER TYPE "WalletOwnerType" ADD VALUE 'SELLER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WalletTransactionType" ADD VALUE 'SELLER_PAYOUT';
ALTER TYPE "WalletTransactionType" ADD VALUE 'FULFILLMENT_ALLOCATION';
ALTER TYPE "WalletTransactionType" ADD VALUE 'SELLER_APP_FEE';

-- DropIndex
DROP INDEX "DispatchOffer_orderId_technicianId_key";

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "restrictedFulfillment" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "restrictedReserve" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ServiceOrder" ADD COLUMN     "activeRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pricingVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "DispatchOffer" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "isBranchInvite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wave" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "HardwareUnit" ADD COLUMN     "orderAddonId" UUID,
ADD COLUMN     "sku" TEXT;

-- CreateTable
CREATE TABLE "SellerProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "shopNameFa" TEXT NOT NULL,
    "status" "SellerStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "sellerAppFeeFlat" BIGINT NOT NULL DEFAULT 0,
    "addressFa" TEXT NOT NULL,
    "phone" TEXT,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" TEXT NOT NULL,
    "serviceKey" "ServiceKey" NOT NULL,
    "titleFa" TEXT NOT NULL,
    "unit" "ProductUnit" NOT NULL DEFAULT 'EACH',
    "requiresSerial" BOOLEAN NOT NULL DEFAULT true,
    "weightGrams" INTEGER NOT NULL DEFAULT 500,
    "volumeCm3" INTEGER NOT NULL DEFAULT 1000,
    "handlingClass" TEXT NOT NULL DEFAULT 'STANDARD',
    "specs" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerOffer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sellerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "partnerPrice" BIGINT NOT NULL,
    "onHandQty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SellerOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallationRateCard" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "serviceKey" "ServiceKey" NOT NULL,
    "cityId" UUID,
    "branchId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "standardMinutes" INTEGER NOT NULL,
    "hourlyRate" BIGINT NOT NULL,
    "effortBps" INTEGER NOT NULL DEFAULT 10000,
    "physicalDifficultyBps" INTEGER NOT NULL DEFAULT 10000,
    "technicalDifficultyBps" INTEGER NOT NULL DEFAULT 10000,
    "meteredLaborPerMeter" BIGINT NOT NULL DEFAULT 0,
    "normalAllowance" BIGINT NOT NULL,
    "minVisitWage" BIGINT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InstallationRateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPriceRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "pricingVersion" INTEGER NOT NULL,
    "status" "PriceRevisionStatus" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "bundleBps" INTEGER NOT NULL,
    "sliderBps" INTEGER NOT NULL DEFAULT 0,
    "customerViewJson" JSONB NOT NULL,
    "technicianTermsJson" JSONB NOT NULL,
    "internalSplitJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "OrderPriceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAddon" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revisionId" UUID NOT NULL,
    "lineKey" TEXT NOT NULL,
    "bucket" "InvoiceBucket" NOT NULL,
    "kind" "AddonKind" NOT NULL,
    "orderItemId" UUID,
    "fulfillmentId" UUID,
    "sellerOfferId" UUID,
    "rateCardId" UUID,
    "sku" TEXT,
    "titleFa" TEXT NOT NULL,
    "unit" "ProductUnit" NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "lineTotal" BIGINT NOT NULL,

    CONSTRAINT "OrderAddon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyFulfillment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID,
    "sellerId" UUID NOT NULL,
    "deliveryMode" "DeliveryMode" NOT NULL,
    "freightCost" BIGINT NOT NULL,
    "status" "FulfillmentStatus" NOT NULL DEFAULT 'RESERVED',
    "notesFa" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyFulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowPosition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID,
    "payerWalletId" UUID NOT NULL,
    "heldAmount" BIGINT NOT NULL,
    "settledAmount" BIGINT NOT NULL DEFAULT 0,
    "activeRevision" INTEGER NOT NULL,
    "status" "EscrowPositionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscrowPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellerProfile_userId_key" ON "SellerProfile"("userId");

-- CreateIndex
CREATE INDEX "SellerProfile_cityId_status_idx" ON "SellerProfile"("cityId", "status");

-- CreateIndex
CREATE INDEX "SellerProfile_branchId_idx" ON "SellerProfile"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "SellerOffer_productId_isActive_idx" ON "SellerOffer"("productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SellerOffer_sellerId_sellerSku_key" ON "SellerOffer"("sellerId", "sellerSku");

-- CreateIndex
CREATE UNIQUE INDEX "InstallationRateCard_code_key" ON "InstallationRateCard"("code");

-- CreateIndex
CREATE INDEX "InstallationRateCard_serviceKey_cityId_branchId_isActive_idx" ON "InstallationRateCard"("serviceKey", "cityId", "branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPriceRevision_orderId_revision_key" ON "OrderPriceRevision"("orderId", "revision");

-- CreateIndex
CREATE INDEX "OrderAddon_fulfillmentId_idx" ON "OrderAddon"("fulfillmentId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAddon_revisionId_lineKey_key" ON "OrderAddon"("revisionId", "lineKey");

-- CreateIndex
CREATE INDEX "SupplyFulfillment_orderId_idx" ON "SupplyFulfillment"("orderId");

-- CreateIndex
CREATE INDEX "SupplyFulfillment_sellerId_createdAt_idx" ON "SupplyFulfillment"("sellerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowPosition_orderId_key" ON "EscrowPosition"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOffer_orderId_attempt_wave_technicianId_key" ON "DispatchOffer"("orderId", "attempt", "wave", "technicianId");

-- CreateIndex
CREATE INDEX "HardwareUnit_orderAddonId_idx" ON "HardwareUnit"("orderAddonId");

-- AddForeignKey
ALTER TABLE "HardwareUnit" ADD CONSTRAINT "HardwareUnit_orderAddonId_fkey" FOREIGN KEY ("orderAddonId") REFERENCES "OrderAddon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationRateCard" ADD CONSTRAINT "InstallationRateCard_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationRateCard" ADD CONSTRAINT "InstallationRateCard_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPriceRevision" ADD CONSTRAINT "OrderPriceRevision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAddon" ADD CONSTRAINT "OrderAddon_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "OrderPriceRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAddon" ADD CONSTRAINT "OrderAddon_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAddon" ADD CONSTRAINT "OrderAddon_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "SupplyFulfillment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAddon" ADD CONSTRAINT "OrderAddon_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAddon" ADD CONSTRAINT "OrderAddon_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "InstallationRateCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyFulfillment" ADD CONSTRAINT "SupplyFulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyFulfillment" ADD CONSTRAINT "SupplyFulfillment_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowPosition" ADD CONSTRAINT "EscrowPosition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowPosition" ADD CONSTRAINT "EscrowPosition_payerWalletId_fkey" FOREIGN KEY ("payerWalletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 1 credited reserve entries to the spendable platform balance.
-- Reclassify those already credited amounts without rewriting ledger history.
UPDATE "Wallet" AS wallet
SET "balance" = wallet."balance" - legacy.reserve,
    "restrictedReserve" = legacy.reserve
FROM (
  SELECT "walletId", SUM("amount") AS reserve
  FROM "WalletTransaction"
  WHERE "type" = 'WARRANTY_RESERVE' AND "status" = 'SETTLED'
  GROUP BY "walletId"
) AS legacy
WHERE wallet."id" = legacy."walletId" AND wallet."ownerType" = 'PLATFORM';

ALTER TABLE "Wallet"
  ADD CONSTRAINT "Wallet_nonnegative_balances" CHECK (
    "balance" >= 0 AND "heldInEscrow" >= 0
    AND "restrictedReserve" >= 0 AND "restrictedFulfillment" >= 0
  ),
  ADD CONSTRAINT "Wallet_platform_only_restrictions" CHECK (
    "ownerType" = 'PLATFORM' OR ("restrictedReserve" = 0 AND "restrictedFulfillment" = 0)
  );

ALTER TABLE "SellerOffer"
  ADD CONSTRAINT "SellerOffer_inventory_bounds" CHECK ("reservedQty" >= 0 AND "reservedQty" <= "onHandQty"),
  ADD CONSTRAINT "SellerOffer_nonnegative_price" CHECK ("partnerPrice" >= 0);

ALTER TABLE "OrderAddon"
  ADD CONSTRAINT "OrderAddon_amount_matches_quantity" CHECK (
    "qty" > 0 AND "unitPrice" >= 0 AND "lineTotal" = "unitPrice" * "qty"
  );

ALTER TABLE "EscrowPosition"
  ADD CONSTRAINT "EscrowPosition_amount_bounds" CHECK ("settledAmount" >= 0 AND "heldAmount" >= "settledAmount");
