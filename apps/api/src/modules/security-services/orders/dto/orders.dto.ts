import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SupplyMode, UrgencyLevel, ServiceKey } from '@prisma/client';
import { SliderSelectionDto } from '../../pricing/dto/slider-selection.dto';

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

export class CreateOrderDto extends SliderSelectionDto {
  @IsUUID()
  addressId!: string;

  @IsOptional()
  @IsUUID()
  securityProfileId?: string;

  @IsOptional()
  @IsUUID()
  propertyId?: string;

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

export class SubmitOrderDto extends SliderSelectionDto {}

export class UpdateOrderPropertyDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  propertyId?: string | null;
}

export class AssignTechnicianDto {
  @IsUUID()
  technicianUserId!: string;
}

export class InspectionScopeDto {
  @IsBoolean()
  matchesFrozenScope!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  revision!: number;
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
