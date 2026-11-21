import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { DispatchService } from './dispatch.service';
import { TechnicianLocationDto, TechnicianStatusDto } from './dto/dispatch.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TECHNICIAN)
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Post('technician/status')
  async setStatus(@CurrentUser() actor: AuthenticatedUser, @Body() dto: TechnicianStatusDto) {
    return this.dispatchService.setTechnicianStatus(actor, dto);
  }

  @Post('technician/location')
  async updateLocation(@CurrentUser() actor: AuthenticatedUser, @Body() dto: TechnicianLocationDto) {
    return this.dispatchService.updateTechnicianLocation(actor, dto);
  }

  @Post('offers/:offerId/accept')
  async acceptOffer(@CurrentUser() actor: AuthenticatedUser, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.dispatchService.acceptOffer(actor, offerId);
  }

  @Post('offers/:offerId/decline')
  async declineOffer(@CurrentUser() actor: AuthenticatedUser, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.dispatchService.declineOffer(actor, offerId);
  }
}
