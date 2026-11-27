import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { CreateSellerOfferDto, UpdateSellerOfferDto } from './dto/seller-portal.dto';
import { SellerPortalService } from './seller-portal.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
@Controller('seller')
export class SellerPortalController {
  constructor(private readonly portal: SellerPortalService) {}

  @Get('profile')
  profile(@CurrentUser() actor: AuthenticatedUser) {
    return this.portal.profile(actor);
  }

  @Get('products')
  products(@CurrentUser() actor: AuthenticatedUser) {
    return this.portal.products(actor);
  }

  @Get('offers')
  offers(@CurrentUser() actor: AuthenticatedUser) {
    return this.portal.offers(actor);
  }

  @Post('offers')
  createOffer(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateSellerOfferDto) {
    return this.portal.createOffer(actor, dto);
  }

  @Patch('offers/:id')
  updateOffer(
    @CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSellerOfferDto,
  ) {
    return this.portal.updateOffer(actor, id, dto);
  }

  @Get('fulfillments')
  fulfillments(@CurrentUser() actor: AuthenticatedUser) {
    return this.portal.fulfillments(actor);
  }

  @Patch('fulfillments/:id/dispatch')
  dispatch(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.dispatch(actor, id);
  }
}
