CREATE TYPE "MeteredAdjustmentStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'AUTO_REFUNDED', 'REJECTED');

CREATE TABLE "OrderMeteredAdjustment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "resultingRevision" INTEGER,
    "status" "MeteredAdjustmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "submittedByUserId" UUID NOT NULL,
    "readingsJson" JSONB NOT NULL,
    "deltaAmount" BIGINT NOT NULL,
    "idempotencyKey" TEXT,
    "customerDecidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderMeteredAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderMeteredAdjustment_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrderMeteredAdjustment_idempotencyKey_key" ON "OrderMeteredAdjustment" ("idempotencyKey");
CREATE INDEX "OrderMeteredAdjustment_orderId_createdAt_idx" ON "OrderMeteredAdjustment" ("orderId", "createdAt");
CREATE UNIQUE INDEX "OrderMeteredAdjustment_one_open_per_order" ON "OrderMeteredAdjustment" ("orderId") WHERE "status" = 'PENDING_APPROVAL';

ALTER TABLE "OrderAddon"
  ADD COLUMN "quantityCm" INTEGER,
  DROP CONSTRAINT "OrderAddon_amount_matches_quantity";

ALTER TABLE "OrderAddon" ADD CONSTRAINT "OrderAddon_amount_matches_quantity" CHECK (
  "unitPrice" >= 0 AND (
    ("quantityCm" IS NULL AND "qty" > 0 AND "lineTotal" = "unitPrice"::numeric * "qty") OR
    ("quantityCm" IS NOT NULL AND "bucket" = 'METERED' AND "unit" = 'METER'
      AND "quantityCm" >= 0 AND "qty" = ("quantityCm"::bigint + 99) / 100
      AND "lineTotal" = floor("unitPrice"::numeric * "quantityCm" / 100))
  )
);
