import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { B2BSupplyService } from './b2b-supply.service';
import { CreateB2BSupplyOrderDto } from './dto/b2b-supply.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('partner-supply')
export class B2BSupplyController {
  constructor(private readonly supply: B2BSupplyService) {}

  @Get('catalog')
  @Roles('TECHNICIAN')
  catalog(@CurrentUser() actor: AuthenticatedUser) {
    return this.supply.catalog(actor);
  }

  @Post('orders')
  @Roles('TECHNICIAN')
  create(@CurrentUser() actor: AuthenticatedUser, @Body() input: CreateB2BSupplyOrderDto) {
    return this.supply.create(actor, input);
  }

  @Get('orders')
  @Roles('TECHNICIAN', 'SUPER_ADMIN')
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.supply.list(actor);
  }

  @Get('orders/:id')
  @Roles('TECHNICIAN', 'SUPER_ADMIN')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.supply.get(actor, id);
  }

  @Post('orders/:id/cancel')
  @Roles('TECHNICIAN')
  cancel(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.supply.cancel(actor, id);
  }

  @Post('fulfillments/:fulfillmentId/confirm-delivery')
  @Roles('TECHNICIAN', 'SELLER')
  confirmDelivery(@CurrentUser() actor: AuthenticatedUser, @Param('fulfillmentId', ParseUUIDPipe) id: string) {
    return this.supply.confirmDelivery(actor, id);
  }
}
