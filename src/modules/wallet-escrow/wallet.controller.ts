import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole, WalletOwnerType } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { WalletEscrowService } from './wallet-escrow.service';
import { ListWalletTransactionsDto, TopUpDto } from './dto/wallet.dto';

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletEscrowService: WalletEscrowService) {}

  @Get('me')
  async me(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListWalletTransactionsDto,
  ) {
    const ownerType =
      actor.role === UserRole.TECHNICIAN ? WalletOwnerType.TECHNICIAN : WalletOwnerType.CUSTOMER;
    return this.walletEscrowService.getMyWallet(
      actor.id,
      ownerType,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Post('topup')
  async topUp(@CurrentUser() actor: AuthenticatedUser, @Body() dto: TopUpDto) {
    // MVP self-topup stub (payment-gateway integration lands later).
    // SUPER_ADMIN may adjust any wallet via ownerType/ownerId.
    const isSuperAdmin = actor.role === UserRole.SUPER_ADMIN;
    const ownerType = isSuperAdmin && dto.ownerType ? dto.ownerType : WalletOwnerType.CUSTOMER;
    const ownerId = isSuperAdmin && dto.ownerId ? dto.ownerId : actor.id;

    return this.walletEscrowService.topUp({
      ownerType,
      ownerId,
      amount: BigInt(dto.amount),
      idempotencyKey: dto.idempotencyKey,
      description: 'شارژ کیف پول (درگاه پرداخت — استاب MVP)',
    });
  }
}
