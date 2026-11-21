import { Body, Controller, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { WarrantyService } from './warranty.service';
import { UpdateWarrantyClaimDto } from './dto/warranty.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.BRANCH_ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/warranty-claims')
export class AdminWarrantyClaimsController {
  constructor(private readonly warrantyService: WarrantyService) {}

  @Patch(':id')
  async updateClaim(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarrantyClaimDto,
  ) {
    return this.warrantyService.updateClaim(actor, id, dto);
  }
}
