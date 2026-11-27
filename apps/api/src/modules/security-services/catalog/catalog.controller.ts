import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { LocationType, ServiceKey } from '@prisma/client';
import { CatalogService } from './catalog.service';

/** Public catalog for the Next.js frontend — no authentication. */
@Public()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('schemas')
  async listSchemas(@Query('locationType') locationType?: LocationType) {
    return this.catalogService.listSchemas(locationType);
  }

  @Get('schemas/:key')
  async getSchema(
    @Param('key') key: ServiceKey,
    @Query('locationType') locationType?: LocationType,
  ) {
    return this.catalogService.getSchema(key, locationType);
  }
}
