import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { SupplyMode, UrgencyLevel, ServiceKey } from '@prisma/client';

export class CreateOrderItemDto {
  @IsIn(Object.values(ServiceKey))
  serviceKey!: ServiceKey;

  @IsOptional()
  @IsIn(Object.values(SupplyMode))
  supplyMode?: SupplyMode;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class CreateOrderDto {
  @IsUUID()
  addressId!: string;

  @IsOptional()
  @IsUUID()
  securityProfileId?: string;

  @IsOptional()
  @IsIn(Object.values(UrgencyLevel))
  urgency?: UrgencyLevel;

  @IsOptional()
  @IsIn(Object.values(SupplyMode))
  supplyMode?: SupplyMode;

  @IsArray()
  @ArrayNotEmpty({ message: 'حداقل یک سرویس برای ثبت سفارش لازم است.' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}

export class AssignTechnicianDto {
  @IsUUID()
  technicianUserId!: string;
}

export class QuoteOrderDto {
  /** Integer Toman (JSON has no BigInt — converted in the service). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  finalQuoteAmount!: number;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  quoteNoteFa?: string;
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @Length(0, 300)
  reason?: string;
}

export class ListOrdersDto {
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
