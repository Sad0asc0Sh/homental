import { Module } from '@nestjs/common';
import { AdminConfigController } from './admin-config.controller';
import { AdminConfigService } from './admin-config.service';

/** CORE module (ARCHITECTURE.md Invariant 11) — never imports verticals. */
@Module({
  controllers: [AdminConfigController],
  providers: [AdminConfigService],
  exports: [AdminConfigService],
})
export class AdminConfigModule {}
