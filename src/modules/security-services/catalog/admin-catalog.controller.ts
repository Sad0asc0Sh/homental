import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole, ServiceKey } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { CatalogService } from './catalog.service';
import {
  CreateServiceDefinitionDto,
  UpdateServiceDefinitionDto,
} from './dto/catalog.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/catalog/services')
export class AdminCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post()
  async create(@Body() dto: CreateServiceDefinitionDto) {
    return this.catalogService.createService(dto);
  }

  @Patch(':key')
  async update(@Param('key') key: ServiceKey, @Body() dto: UpdateServiceDefinitionDto) {
    return this.catalogService.updateService(key, dto);
  }
}
