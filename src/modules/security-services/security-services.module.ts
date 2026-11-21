import { Module } from '@nestjs/common';
import { WalletEscrowModule } from '@modules/wallet-escrow/wallet-escrow.module';
import { AdminCatalogController } from './catalog/admin-catalog.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { AdminAdvisoryRulesController } from './advisory/admin-advisory-rules.controller';
import { AdvisoryController } from './advisory/advisory.controller';
import { AdvisoryService } from './advisory/advisory.service';
import { SecurityProfilesController } from './advisory/security-profiles.controller';
import { DispatchController } from './dispatch/dispatch.controller';
import { DispatchService } from './dispatch/dispatch.service';
import { DispatchSweeperService } from './dispatch/dispatch-sweeper.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { DynamicFactorsService } from './pricing/dynamic-factors.service';
import { PricingController } from './pricing/pricing.controller';
import { PricingSchemaInterpreter } from './pricing/pricing-schema.interpreter';
import { PricingService } from './pricing/pricing.service';
import { ReviewsController } from './reviews/reviews.controller';
import { ReviewsService } from './reviews/reviews.service';
import { AdminWarrantyClaimsController } from './warranty/admin-warranty-claims.controller';
import { WarrantyController } from './warranty/warranty.controller';
import { WarrantyService } from './warranty/warranty.service';
import { JsonLogicEvaluator } from './shared/json-logic.evaluator';

/**
 * The Phase-1 vertical (ARCHITECTURE.md Invariant 11): may import core
 * modules (WalletEscrowModule) and infrastructure, but core modules never
 * import this. Dispatch/Handover/Warranty complete the Snapp-like lifecycle.
 */
@Module({
  imports: [WalletEscrowModule],
  controllers: [
    CatalogController,
    AdminCatalogController,
    AdvisoryController,
    SecurityProfilesController,
    AdminAdvisoryRulesController,
    PricingController,
    OrdersController,
    DispatchController,
    WarrantyController,
    AdminWarrantyClaimsController,
    ReviewsController,
  ],
  providers: [
    JsonLogicEvaluator,
    CatalogService,
    AdvisoryService,
    PricingSchemaInterpreter,
    DynamicFactorsService,
    PricingService,
    OrdersService,
    DispatchService,
    DispatchSweeperService,
    WarrantyService,
    ReviewsService,
  ],
  exports: [JsonLogicEvaluator, CatalogService, AdvisoryService, PricingService, OrdersService, DispatchService],
})
export class SecurityServicesModule {}
