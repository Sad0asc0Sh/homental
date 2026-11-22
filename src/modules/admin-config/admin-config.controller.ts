import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { AdminConfigService } from './admin-config.service';
import { UpdatePlatformConfigDto } from './dto/update-platform-config.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/platform-config')
export class AdminConfigController {
  constructor(private readonly adminConfigService: AdminConfigService) {}

  @Get()
  async listAll() {
    return this.adminConfigService.listAll();
  }

  @Patch(':key')
  async updateByKey(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdatePlatformConfigDto,
  ) {
    return this.adminConfigService.updateByKey(actor, key, dto.value);
  }
}
