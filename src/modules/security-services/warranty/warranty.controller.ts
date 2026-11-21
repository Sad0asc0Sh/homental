import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { WarrantyService } from './warranty.service';
import {
  CompleteHandoverDto,
  CreateWarrantyClaimDto,
  RegisterHardwareUnitsDto,
  RequestHandoverDto,
} from './dto/warranty.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class WarrantyController {
  constructor(private readonly warrantyService: WarrantyService) {}

  /** Step 1 of the Handover Gate — hardware serials (Invariant 9). */
  @Roles(UserRole.TECHNICIAN)
  @Post('orders/:id/hardware-units')
  async registerHardwareUnits(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterHardwareUnitsDto,
  ) {
    return this.warrantyService.registerHardwareUnits(actor, id, dto);
  }

  /** Step 2 — privacy checklist + handover OTP (Invariant 9). */
  @Roles(UserRole.TECHNICIAN)
  @Post('orders/:id/request-handover')
  async requestHandover(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestHandoverDto,
  ) {
    return this.warrantyService.requestHandover(actor, id, dto);
  }

  /** Step 3 — complete handover: warranty activation + escrow release. */
  @Roles(UserRole.TECHNICIAN)
  @Post('orders/:id/complete-handover')
  async completeHandover(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteHandoverDto,
  ) {
    return this.warrantyService.completeHandover(actor, id, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Get('warranties/me')
  async myWarranties(@CurrentUser() actor: AuthenticatedUser) {
    return this.warrantyService.myWarranties(actor);
  }

  @Roles(UserRole.CUSTOMER)
  @Post('warranties/:id/claims')
  async createClaim(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWarrantyClaimDto,
  ) {
    return this.warrantyService.createClaim(actor, id, dto);
  }
}
