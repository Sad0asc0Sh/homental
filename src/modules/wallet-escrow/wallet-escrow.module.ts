import { Module } from '@nestjs/common';
import { AdminFinanceController } from './admin-finance.controller';
import { WalletController } from './wallet.controller';
import { WalletEscrowService } from './wallet-escrow.service';

/**
 * CORE module (ARCHITECTURE.md Invariant 11): reusable by security-services,
 * cafe booking, second-hand goods, etc. It MUST NEVER import any vertical.
 */
@Module({
  controllers: [WalletController, AdminFinanceController],
  providers: [WalletEscrowService],
  exports: [WalletEscrowService],
})
export class WalletEscrowModule {}
