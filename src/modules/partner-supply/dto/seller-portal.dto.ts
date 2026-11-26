import { IsBoolean, IsInt, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

const INTEGER_MAX = 2_147_483_647;
const NONNEGATIVE_TOMAN = /^(0|[1-9]\d{0,18})$/;
const priceMessage = 'قیمت همکار را به‌صورت عدد صحیح تومان وارد کنید.';

export class CreateSellerOfferDto {
  @IsUUID()
  productId!: string;

  @IsString()
  @Length(1, 100)
  sellerSku!: string;

  @Matches(NONNEGATIVE_TOMAN, { message: priceMessage })
  partnerPrice!: string;

  @IsInt()
  @Min(0)
  @Max(INTEGER_MAX)
  onHandQty!: number;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSellerOfferDto {
  @IsInt()
  @Min(1)
  @Max(INTEGER_MAX - 1)
  version!: number;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @Matches(NONNEGATIVE_TOMAN, { message: priceMessage })
  partnerPrice?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(INTEGER_MAX)
  onHandQty?: number;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
