import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { WalletEscrowService } from './wallet-escrow.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(private readonly walletEscrowService: WalletEscrowService) {}

  @Get('summary')
  async summary() {
    return this.walletEscrowService.getFinanceSummary();
  }
}
