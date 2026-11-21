import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SupplyMode, UrgencyLevel, ServiceKey } from '@prisma/client';

export class EstimateItemDto {
  @IsIn(Object.values(ServiceKey))
  serviceKey!: ServiceKey;

  @IsOptional()
  @IsIn(Object.values(SupplyMode))
  supplyMode?: SupplyMode;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class EstimateDto {
  @IsOptional()
  @IsString()
  citySlug?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsIn(Object.values(UrgencyLevel))
  urgency?: UrgencyLevel;

  @IsOptional()
  @IsIn(Object.values(SupplyMode))
  supplyMode?: SupplyMode;

  @IsArray()
  @ArrayNotEmpty({ message: 'حداقل یک سرویس برای برآورد قیمت لازم است.' })
  @ValidateNested({ each: true })
  @Type(() => EstimateItemDto)
  items!: EstimateItemDto[];
}
