import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsLatitude, IsLongitude, IsNumber, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';

export class B2BSupplyItemDto {
  @IsUUID()
  sellerOfferId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  qty!: number;
}

export class CreateB2BSupplyOrderDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(5, 500)
  deliveryAddressFa!: string;

  @IsNumber()
  @IsLatitude()
  lat!: number;

  @IsNumber()
  @IsLongitude()
  lng!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => B2BSupplyItemDto)
  items!: B2BSupplyItemDto[];
}
