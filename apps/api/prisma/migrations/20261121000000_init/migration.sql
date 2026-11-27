-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'TECHNICIAN', 'BRANCH_ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "TechnicianStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'PHONE_VERIFY');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('APARTMENT', 'VILLA', 'SHOP', 'PARKING', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "SecurityPillar" AS ENUM ('PHYSICAL', 'INTRUSION', 'MONITORING');

-- CreateEnum
CREATE TYPE "ServiceKey" AS ENUM ('ELECTRIC_SHUTTER', 'PARKING_JACK', 'ALARM', 'CCTV');

-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('DRAFT', 'ESTIMATED', 'SEARCHING_EXPERT', 'EXPERT_ASSIGNED', 'ON_THE_WAY', 'INSPECTING', 'QUOTE_APPROVED', 'IN_PROGRESS', 'HANDOVER_OTP_PENDING', 'COMPLETED_WARRANTY_ACTIVE', 'CANCELLED', 'BRANCH_QUEUE');

-- CreateEnum
CREATE TYPE "SupplyMode" AS ENUM ('FULL_PACKAGE', 'INSTALL_ONLY');

-- CreateEnum
CREATE TYPE "UrgencyLevel" AS ENUM ('SCHEDULED', 'SAME_DAY', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "DispatchOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WalletOwnerType" AS ENUM ('CUSTOMER', 'TECHNICIAN', 'BRANCH', 'PLATFORM');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('TOPUP', 'ESCROW_HOLD', 'ESCROW_RELEASE', 'PLATFORM_COMMISSION', 'WARRANTY_RESERVE', 'TECHNICIAN_PAYOUT', 'BRANCH_PAYOUT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WalletTransactionStatus" AS ENUM ('PENDING', 'SETTLED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS', 'PUSH', 'SOCKET');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_STATUS_CHANGED', 'DISPATCH_OFFER', 'HANDOVER_OTP', 'WARRANTY_ACTIVATED', 'WALLET_EVENT', 'ADVISORY_RESULT', 'WARRANTY_CLAIM', 'GENERIC');

-- CreateEnum
CREATE TYPE "WarrantyStatus" AS ENUM ('ACTIVE', 'IN_CLAIM', 'EXPIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "WarrantyClaimStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "avatarUrl" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL DEFAULT 'LOGIN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "branchId" UUID,
    "status" "TechnicianStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "skills" "ServiceKey"[],
    "rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "completedJobs" INTEGER NOT NULL DEFAULT 0,
    "warrantyClaimRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "isAcceptingOffers" BOOLEAN NOT NULL DEFAULT true,
    "lastKnownLat" DECIMAL(9,6),
    "lastKnownLng" DECIMAL(10,6),
    "lastLocationAt" TIMESTAMP(3),
    "location" geography(Point,4326),
    "identityCardUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "launchOrder" INTEGER NOT NULL DEFAULT 0,
    "centerLat" DECIMAL(9,6) NOT NULL,
    "centerLng" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "cityId" UUID NOT NULL,
    "adminId" UUID,
    "nameFa" TEXT NOT NULL,
    "addressFa" TEXT NOT NULL,
    "phone" TEXT,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(10,6) NOT NULL,
    "location" geography(Point,4326),
    "serviceRadiusMeters" INTEGER NOT NULL DEFAULT 15000,
    "hasPhysicalShowroom" BOOLEAN NOT NULL DEFAULT false,
    "commissionRateOverride" DECIMAL(5,4),
    "warrantyReserveOverride" DECIMAL(5,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "titleFa" TEXT NOT NULL,
    "locationType" "LocationType" NOT NULL,
    "fullAddressFa" TEXT NOT NULL,
    "postalCode" TEXT,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(10,6) NOT NULL,
    "location" geography(Point,4326),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerType" "WalletOwnerType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "heldInEscrow" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TOMAN',
    "branchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "walletId" UUID NOT NULL,
    "orderId" UUID,
    "type" "WalletTransactionType" NOT NULL,
    "status" "WalletTransactionStatus" NOT NULL DEFAULT 'SETTLED',
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "description" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "titleFa" TEXT NOT NULL,
    "bodyFa" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID
);

-- CreateTable
CREATE TABLE "ServiceDefinition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" "ServiceKey" NOT NULL,
    "pillar" "SecurityPillar" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "titleFa" TEXT NOT NULL,
    "subtitleFa" TEXT,
    "descriptionFa" TEXT,
    "iconKey" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "supportedLocationTypes" "LocationType"[],
    "baseReadinessScore" INTEGER NOT NULL DEFAULT 0,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 12,
    "typicalDurationMinutes" INTEGER NOT NULL DEFAULT 120,
    "uiSchema" JSONB NOT NULL,
    "pricingSchema" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisoryRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "pillar" "SecurityPillar" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "appliesToLocationTypes" "LocationType"[],
    "condition" JSONB NOT NULL,
    "suggestedActionFa" TEXT NOT NULL,
    "suggestedServiceKey" "ServiceKey",
    "suggestedConfig" JSONB,
    "scoreImpact" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvisoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,
    "addressId" UUID NOT NULL,
    "titleFa" TEXT,
    "locationType" "LocationType" NOT NULL,
    "buildingContext" JSONB,
    "servicesConfig" JSONB NOT NULL,
    "readinessScore" JSONB,
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOrder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderNumber" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "technicianId" UUID,
    "branchId" UUID,
    "securityProfileId" UUID,
    "addressId" UUID NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(10,6),
    "location" geography(Point,4326),
    "state" "OrderState" NOT NULL DEFAULT 'DRAFT',
    "locationType" "LocationType" NOT NULL,
    "urgency" "UrgencyLevel" NOT NULL DEFAULT 'SCHEDULED',
    "supplyMode" "SupplyMode" NOT NULL DEFAULT 'FULL_PACKAGE',
    "scheduledAt" TIMESTAMP(3),
    "pricing" JSONB,
    "surgeMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "urgencyMultiplier" DECIMAL(3,2) NOT NULL DEFAULT 1,
    "bundleDiscountPercent" INTEGER NOT NULL DEFAULT 0,
    "finalQuoteAmount" BIGINT,
    "handoverOtpHash" TEXT,
    "handoverOtpExpiresAt" TIMESTAMP(3),
    "handoverAttempts" INTEGER NOT NULL DEFAULT 0,
    "privacyChecklistSignedAt" TIMESTAMP(3),
    "privacyChecklistAnswers" JSONB,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "serviceDefinitionId" UUID NOT NULL,
    "config" JSONB NOT NULL,
    "supplyMode" "SupplyMode",
    "pricingSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchOffer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "technicianId" UUID NOT NULL,
    "status" "DispatchOfferStatus" NOT NULL DEFAULT 'PENDING',
    "radiusMeters" INTEGER NOT NULL,
    "distanceMeters" INTEGER,
    "score" DECIMAL(5,2) NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "orderLockKey" TEXT NOT NULL,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HardwareUnit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderItemId" UUID NOT NULL,
    "categoryFa" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredByUserId" UUID,

    CONSTRAINT "HardwareUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warranty" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "policyNumber" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "WarrantyStatus" NOT NULL DEFAULT 'ACTIVE',
    "coverageMonths" INTEGER NOT NULL,
    "coverage" JSONB,
    "warrantyReserveAmount" BIGINT,
    "escrowReleasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyClaim" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warrantyId" UUID NOT NULL,
    "openedByUserId" UUID NOT NULL,
    "status" "WarrantyClaimStatus" NOT NULL DEFAULT 'OPEN',
    "descriptionFa" TEXT NOT NULL,
    "photos" JSONB,
    "resolutionNoteFa" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarrantyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStateTransition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "fromState" "OrderState",
    "toState" "OrderState" NOT NULL,
    "actorUserId" UUID,
    "actorRole" "UserRole",
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStateTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "commentFa" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "User_status_createdAt_idx" ON "User"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OtpCode_phone_createdAt_idx" ON "OtpCode"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "OtpCode_userId_idx" ON "OtpCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_userId_key" ON "CustomerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianProfile_userId_key" ON "TechnicianProfile"("userId");

-- CreateIndex
CREATE INDEX "TechnicianProfile_branchId_idx" ON "TechnicianProfile"("branchId");

-- CreateIndex
CREATE INDEX "TechnicianProfile_status_isOnline_isAcceptingOffers_idx" ON "TechnicianProfile"("status", "isOnline", "isAcceptingOffers");

-- CreateIndex
CREATE INDEX "TechnicianProfile_skills_idx" ON "TechnicianProfile"("skills");

-- CreateIndex
CREATE UNIQUE INDEX "City_slug_key" ON "City"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_adminId_key" ON "Branch"("adminId");

-- CreateIndex
CREATE INDEX "Branch_cityId_isActive_idx" ON "Branch"("cityId", "isActive");

-- CreateIndex
CREATE INDEX "Address_customerId_idx" ON "Address"("customerId");

-- CreateIndex
CREATE INDEX "Address_cityId_locationType_idx" ON "Address"("cityId", "locationType");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_branchId_key" ON "Wallet"("branchId");

-- CreateIndex
CREATE INDEX "Wallet_ownerType_idx" ON "Wallet"("ownerType");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_ownerType_ownerId_key" ON "Wallet"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_orderId_idx" ON "WalletTransaction"("orderId");

-- CreateIndex
CREATE INDEX "WalletTransaction_type_status_idx" ON "WalletTransaction"("type", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformConfig_key_key" ON "PlatformConfig"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDefinition_key_key" ON "ServiceDefinition"("key");

-- CreateIndex
CREATE INDEX "ServiceDefinition_pillar_isActive_idx" ON "ServiceDefinition"("pillar", "isActive");

-- CreateIndex
CREATE INDEX "ServiceDefinition_isActive_displayOrder_idx" ON "ServiceDefinition"("isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AdvisoryRule_code_key" ON "AdvisoryRule"("code");

-- CreateIndex
CREATE INDEX "AdvisoryRule_isActive_priority_idx" ON "AdvisoryRule"("isActive", "priority");

-- CreateIndex
CREATE INDEX "SecurityProfile_customerId_idx" ON "SecurityProfile"("customerId");

-- CreateIndex
CREATE INDEX "SecurityProfile_locationType_idx" ON "SecurityProfile"("locationType");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_orderNumber_key" ON "ServiceOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "ServiceOrder_customerId_createdAt_idx" ON "ServiceOrder"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceOrder_technicianId_state_idx" ON "ServiceOrder"("technicianId", "state");

-- CreateIndex
CREATE INDEX "ServiceOrder_state_createdAt_idx" ON "ServiceOrder"("state", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceOrder_branchId_state_idx" ON "ServiceOrder"("branchId", "state");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_serviceDefinitionId_idx" ON "OrderItem"("serviceDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_serviceDefinitionId_key" ON "OrderItem"("orderId", "serviceDefinitionId");

-- CreateIndex
CREATE INDEX "DispatchOffer_orderId_status_idx" ON "DispatchOffer"("orderId", "status");

-- CreateIndex
CREATE INDEX "DispatchOffer_technicianId_status_idx" ON "DispatchOffer"("technicianId", "status");

-- CreateIndex
CREATE INDEX "DispatchOffer_status_expiresAt_idx" ON "DispatchOffer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOffer_orderId_technicianId_key" ON "DispatchOffer"("orderId", "technicianId");

-- CreateIndex
CREATE UNIQUE INDEX "HardwareUnit_serialNumber_key" ON "HardwareUnit"("serialNumber");

-- CreateIndex
CREATE INDEX "HardwareUnit_orderItemId_idx" ON "HardwareUnit"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Warranty_policyNumber_key" ON "Warranty"("policyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Warranty_orderId_key" ON "Warranty"("orderId");

-- CreateIndex
CREATE INDEX "Warranty_status_endDate_idx" ON "Warranty"("status", "endDate");

-- CreateIndex
CREATE INDEX "WarrantyClaim_warrantyId_status_idx" ON "WarrantyClaim"("warrantyId", "status");

-- CreateIndex
CREATE INDEX "OrderStateTransition_orderId_createdAt_idx" ON "OrderStateTransition"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderStateTransition_toState_createdAt_idx" ON "OrderStateTransition"("toState", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");

-- CreateIndex
CREATE INDEX "Review_authorId_idx" ON "Review"("authorId");

-- AddForeignKey
ALTER TABLE "OtpCode" ADD CONSTRAINT "OtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianProfile" ADD CONSTRAINT "TechnicianProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianProfile" ADD CONSTRAINT "TechnicianProfile_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityProfile" ADD CONSTRAINT "SecurityProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityProfile" ADD CONSTRAINT "SecurityProfile_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_securityProfileId_fkey" FOREIGN KEY ("securityProfileId") REFERENCES "SecurityProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_serviceDefinitionId_fkey" FOREIGN KEY ("serviceDefinitionId") REFERENCES "ServiceDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "TechnicianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HardwareUnit" ADD CONSTRAINT "HardwareUnit_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "Warranty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStateTransition" ADD CONSTRAINT "OrderStateTransition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStateTransition" ADD CONSTRAINT "OrderStateTransition_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Homental PostGIS automation (Prisma cannot author these natively)
-- ============================================================================

-- Geo sync: keep "location" in sync from lat/lng pairs (Branch/Address/ServiceOrder)
CREATE OR REPLACE FUNCTION homental_sync_location() RETURNS trigger AS $$
BEGIN
  IF NEW."lat" IS NOT NULL AND NEW."lng" IS NOT NULL THEN
    NEW."location" := ST_SetSRID(ST_MakePoint(NEW."lng"::double precision, NEW."lat"::double precision), 4326)::geography;
  ELSE
    NEW."location" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Geo sync: TechnicianProfile uses lastKnownLat/lastKnownLng (nullable)
CREATE OR REPLACE FUNCTION homental_sync_technician_location() RETURNS trigger AS $$
BEGIN
  IF NEW."lastKnownLat" IS NOT NULL AND NEW."lastKnownLng" IS NOT NULL THEN
    NEW."location" := ST_SetSRID(ST_MakePoint(NEW."lastKnownLng"::double precision, NEW."lastKnownLat"::double precision), 4326)::geography;
  ELSE
    NEW."location" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Branch_location_sync"              BEFORE INSERT OR UPDATE OF "lat", "lng"                   ON "Branch"            FOR EACH ROW EXECUTE FUNCTION homental_sync_location();
CREATE TRIGGER "Address_location_sync"             BEFORE INSERT OR UPDATE OF "lat", "lng"                   ON "Address"           FOR EACH ROW EXECUTE FUNCTION homental_sync_location();
CREATE TRIGGER "ServiceOrder_location_sync"        BEFORE INSERT OR UPDATE OF "lat", "lng"                   ON "ServiceOrder"      FOR EACH ROW EXECUTE FUNCTION homental_sync_location();
CREATE TRIGGER "TechnicianProfile_location_sync"   BEFORE INSERT OR UPDATE OF "lastKnownLat", "lastKnownLng" ON "TechnicianProfile" FOR EACH ROW EXECUTE FUNCTION homental_sync_technician_location();

-- Spatial indexes (GIST) for the 4 geography columns
CREATE INDEX IF NOT EXISTS "Branch_location_gist"            ON "Branch"            USING GIST ("location");
CREATE INDEX IF NOT EXISTS "Address_location_gist"           ON "Address"           USING GIST ("location");
CREATE INDEX IF NOT EXISTS "ServiceOrder_location_gist"      ON "ServiceOrder"      USING GIST ("location");
CREATE INDEX IF NOT EXISTS "TechnicianProfile_location_gist" ON "TechnicianProfile" USING GIST ("location");

-- GIN index for skill-array matching in dispatch candidate queries
CREATE INDEX IF NOT EXISTS "TechnicianProfile_skills_gin" ON "TechnicianProfile" USING GIN ("skills");
