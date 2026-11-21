import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { WalletOwnerType } from '@prisma/client';

export class TopUpDto {
  /** Integer Toman (JSON has no BigInt — converted in the service). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  @Length(6, 100)
  idempotencyKey!: string;

  /** SUPER_ADMIN-only adjustments (defaults to the caller's own wallet). */
  @IsOptional()
  @IsIn(Object.values(WalletOwnerType))
  ownerType?: WalletOwnerType;

  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

export class ListWalletTransactionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
