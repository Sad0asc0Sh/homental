import { Module } from '@nestjs/common';
import { AdminCatalogController } from './catalog/admin-catalog.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { AdminAdvisoryRulesController } from './advisory/admin-advisory-rules.controller';
import { AdvisoryController } from './advisory/advisory.controller';
import { AdvisoryService } from './advisory/advisory.service';
import { SecurityProfilesController } from './advisory/security-profiles.controller';
import { DynamicFactorsService } from './pricing/dynamic-factors.service';
import { PricingController } from './pricing/pricing.controller';
import { PricingSchemaInterpreter } from './pricing/pricing-schema.interpreter';
import { PricingService } from './pricing/pricing.service';
import { JsonLogicEvaluator } from './shared/json-logic.evaluator';

/**
 * The Phase-1 vertical (ARCHITECTURE.md Invariant 11): may import core
 * modules and infrastructure, but core modules never import this.
 * The shared JsonLogicEvaluator is exported so the PricingEngine reuses
 * the exact same dialect; PricingService is exported for OrdersService (Task 5).
 */
@Module({
  controllers: [
    CatalogController,
    AdminCatalogController,
    AdvisoryController,
    SecurityProfilesController,
    AdminAdvisoryRulesController,
    PricingController,
  ],
  providers: [
    JsonLogicEvaluator,
    CatalogService,
    AdvisoryService,
    PricingSchemaInterpreter,
    DynamicFactorsService,
    PricingService,
  ],
  exports: [JsonLogicEvaluator, CatalogService, AdvisoryService, PricingService],
})
export class SecurityServicesModule {}
