import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole, WalletOwnerType } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { toPersonalPosting, WalletEscrowService } from './wallet-escrow.service';
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
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    switch (actor.role) {
      case UserRole.CUSTOMER:
      case UserRole.TECHNICIAN:
      case UserRole.SELLER:
        return this.walletEscrowService.getMyWallet(actor.id, actor.role, page, limit);
      case UserRole.BRANCH_ADMIN:
        if (actor.branchId) return this.walletEscrowService.getMyWallet(actor.branchId, 'BRANCH', page, limit);
        throw new ForbiddenException('کیف پول شعبه برای این حساب در دسترس نیست.');
      case UserRole.SUPER_ADMIN:
      default:
        throw new ForbiddenException('کیف پول شخصی برای این حساب در دسترس نیست.');
    }
  }

  @Post('topup')
  async topUp(@CurrentUser() actor: AuthenticatedUser, @Body() dto: TopUpDto) {
    // MVP self-topup stub (payment-gateway integration lands later).
    // SUPER_ADMIN may adjust any wallet via ownerType/ownerId.
    const role = actor.role;
    if (role !== UserRole.SUPER_ADMIN && role !== UserRole.CUSTOMER && role !== UserRole.TECHNICIAN) throw new ForbiddenException();
    const ownerType = role === UserRole.SUPER_ADMIN ? dto.ownerType ?? WalletOwnerType.CUSTOMER : role;
    const ownerId = role === UserRole.SUPER_ADMIN && dto.ownerId ? dto.ownerId : actor.id;
    const amount = BigInt(dto.amount);
    if (amount > 9_223_372_036_854_775_807n) {
      throw new BadRequestException('مبلغ شارژ از سقف مجاز بیشتر است.');
    }

    return toPersonalPosting(await this.walletEscrowService.topUp({
      ownerType,
      ownerId,
      amount,
      idempotencyKey: dto.idempotencyKey,
      description: 'شارژ کیف پول (درگاه پرداخت — استاب MVP)',
    }));
  }
}
