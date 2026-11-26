import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { WalletOwnerType } from '@prisma/client';

export class TopUpDto {
  /** Preserve exact Toman strings and accept safe integer numbers from existing clients. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value,
  )
  @Matches(/^[1-9]\d{0,18}$/, { message: 'مبلغ شارژ باید یک عدد صحیح مثبت به تومان باشد.' })
  amount!: string;

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
