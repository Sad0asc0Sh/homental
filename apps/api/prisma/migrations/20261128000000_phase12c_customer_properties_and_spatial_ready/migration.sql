-- Phase 12C: Additive customer property profiles & spatial media assets

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'VILLA', 'OFFICE', 'INDUSTRIAL');

-- CreateEnum
CREATE TYPE "PropertyAssetKind" AS ENUM ('PHOTO', 'SURVEY_VIDEO', 'MODEL_3D_GLB', 'FLOORPLAN_JSON');

-- CreateEnum
CREATE TYPE "PropertyAssetStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "CustomerProperty" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "cityId" UUID,
    "title" TEXT NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(10,6) NOT NULL,
    "location" geography(Point,4326),
    "notes" TEXT,
    "defaultDimensionsJson" JSONB,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyMediaAsset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "propertyId" UUID NOT NULL,
    "uploadedByUserId" UUID NOT NULL,
    "kind" "PropertyAssetKind" NOT NULL,
    "status" "PropertyAssetStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "publicUrl" TEXT,
    "spatialMetadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyMediaAsset_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ServiceOrder" ADD COLUMN "propertyId" UUID;

-- CreateIndex
CREATE INDEX "CustomerProperty_userId_isArchived_createdAt_idx" ON "CustomerProperty"("userId", "isArchived", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerProperty_cityId_idx" ON "CustomerProperty"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyMediaAsset_storageKey_key" ON "PropertyMediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "PropertyMediaAsset_propertyId_kind_status_idx" ON "PropertyMediaAsset"("propertyId", "kind", "status");

-- CreateIndex
CREATE INDEX "PropertyMediaAsset_uploadedByUserId_idx" ON "PropertyMediaAsset"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "ServiceOrder_propertyId_idx" ON "ServiceOrder"("propertyId");

-- AddForeignKey
ALTER TABLE "CustomerProperty" ADD CONSTRAINT "CustomerProperty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProperty" ADD CONSTRAINT "CustomerProperty_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMediaAsset" ADD CONSTRAINT "PropertyMediaAsset_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "CustomerProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMediaAsset" ADD CONSTRAINT "PropertyMediaAsset_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "CustomerProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PostGIS trigger & spatial index (mirrors Invariant 10)
CREATE TRIGGER "CustomerProperty_location_sync"
    BEFORE INSERT OR UPDATE OF "lat", "lng"
    ON "CustomerProperty"
    FOR EACH ROW EXECUTE FUNCTION homental_sync_location();

CREATE INDEX IF NOT EXISTS "CustomerProperty_location_gist"
    ON "CustomerProperty" USING GIST ("location");
