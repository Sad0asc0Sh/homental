import { Module } from '@nestjs/common';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { WalletEscrowModule } from '@modules/wallet-escrow/wallet-escrow.module';
import { B2BSupplyController } from './b2b-supply.controller';
import { B2BSupplyService } from './b2b-supply.service';
import { SellerPortalController } from './seller-portal.controller';
import { SellerPortalService } from './seller-portal.service';
import { SupplierCasesController } from './supplier-cases.controller';
import { SupplierCasesService } from './supplier-cases.service';

@Module({
  imports: [NotificationsModule, WalletEscrowModule],
  controllers: [B2BSupplyController, SellerPortalController, SupplierCasesController],
  providers: [B2BSupplyService, SellerPortalService, SupplierCasesService],
})
export class PartnerSupplyModule {}
