import { Module } from '@nestjs/common';
import { WalletEscrowModule } from '@modules/wallet-escrow/wallet-escrow.module';
import { AdminCatalogController } from './catalog/admin-catalog.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { AdminAdvisoryRulesController } from './advisory/admin-advisory-rules.controller';
import { AdvisoryController } from './advisory/advisory.controller';
import { AdvisoryService } from './advisory/advisory.service';
import { SecurityProfilesController } from './advisory/security-profiles.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { DynamicFactorsService } from './pricing/dynamic-factors.service';
import { PricingController } from './pricing/pricing.controller';
import { PricingSchemaInterpreter } from './pricing/pricing-schema.interpreter';
import { PricingService } from './pricing/pricing.service';
import { JsonLogicEvaluator } from './shared/json-logic.evaluator';

/**
 * The Phase-1 vertical (ARCHITECTURE.md Invariant 11): may import core
 * modules (WalletEscrowModule) and infrastructure, but core modules never
 * import this. PricingService and OrdersService are exported for Task 6
 * (Dispatch, Handover Gate & Warranty).
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
  ],
  providers: [
    JsonLogicEvaluator,
    CatalogService,
    AdvisoryService,
    PricingSchemaInterpreter,
    DynamicFactorsService,
    PricingService,
    OrdersService,
  ],
  exports: [JsonLogicEvaluator, CatalogService, AdvisoryService, PricingService, OrdersService],
})
export class SecurityServicesModule {}
