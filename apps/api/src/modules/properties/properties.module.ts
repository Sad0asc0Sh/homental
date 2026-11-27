import { Module } from '@nestjs/common';
import {
  LocalDevMediaStorageProvider,
  MEDIA_STORAGE_PROVIDER,
} from './media-storage.provider';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';

/**
 * Core customer property & spatial media module (Invariant 11: vertical-agnostic,
 * reusable across security-services and future verticals).
 */
@Module({
  controllers: [PropertiesController],
  providers: [
    PropertiesService,
    LocalDevMediaStorageProvider,
    { provide: MEDIA_STORAGE_PROVIDER, useExisting: LocalDevMediaStorageProvider },
  ],
  exports: [PropertiesService, MEDIA_STORAGE_PROVIDER],
})
export class PropertiesModule {}
