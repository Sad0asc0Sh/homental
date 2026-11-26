import { ConflictException } from '@nestjs/common';

export interface WalletShortfallBody {
  errorCode: 'WALLET_SHORTFALL';
  revision: number;
  delta: string;
  available: string;
  shortfall: string;
  currency: 'TOMAN';
}

export class WalletShortfallException extends ConflictException {
  readonly body: WalletShortfallBody;

  constructor(revision: number, delta: bigint, available: bigint) {
    const body: WalletShortfallBody = {
      errorCode: 'WALLET_SHORTFALL', revision, delta: delta.toString(), available: available.toString(),
      shortfall: (delta - available).toString(), currency: 'TOMAN',
    };
    super({ ...body });
    this.body = body;
  }
}
