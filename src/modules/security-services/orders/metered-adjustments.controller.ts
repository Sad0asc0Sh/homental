import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { ApproveMeteredAdjustmentDto, SubmitMeterReadingsDto } from './dto/metered-adjustments.dto';
import { MeteredAdjustmentsService } from './metered-adjustments.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders/:id')
export class MeteredAdjustmentsController {
  constructor(private readonly metering: MeteredAdjustmentsService) {}

  @Roles('TECHNICIAN')
  @Post('meter-readings')
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: SubmitMeterReadingsDto,
  ) {
    return this.metering.submit(actor, orderId, dto);
  }

  @Roles('CUSTOMER')
  @Post('adjustments/:adjustmentId/approve')
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @Body() dto: ApproveMeteredAdjustmentDto,
  ) {
    return this.metering.approve(actor, orderId, adjustmentId, dto);
  }

  @Roles('CUSTOMER')
  @Post('adjustments/:adjustmentId/reject')
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
  ) {
    return this.metering.reject(actor, orderId, adjustmentId);
  }
}
