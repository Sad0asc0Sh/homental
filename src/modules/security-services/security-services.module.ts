import { Module } from '@nestjs/common';
import { AdminCatalogController } from './catalog/admin-catalog.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { AdminAdvisoryRulesController } from './advisory/admin-advisory-rules.controller';
import { AdvisoryController } from './advisory/advisory.controller';
import { AdvisoryService } from './advisory/advisory.service';
import { SecurityProfilesController } from './advisory/security-profiles.controller';
import { JsonLogicEvaluator } from './shared/json-logic.evaluator';

/**
 * The Phase-1 vertical (ARCHITECTURE.md Invariant 11): may import core
 * modules and infrastructure, but core modules never import this.
 * The shared JsonLogicEvaluator is exported so the Task 4 PricingEngine
 * reuses the exact same dialect.
 */
@Module({
  controllers: [
    CatalogController,
    AdminCatalogController,
    AdvisoryController,
    SecurityProfilesController,
    AdminAdvisoryRulesController,
  ],
  providers: [JsonLogicEvaluator, CatalogService, AdvisoryService],
  exports: [JsonLogicEvaluator, CatalogService, AdvisoryService],
})
export class SecurityServicesModule {}
