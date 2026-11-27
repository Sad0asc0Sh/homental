import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { LocationType, SecurityPillar, ServiceKey } from '@prisma/client';

export class CreateServiceDefinitionDto {
  @IsIn(Object.values(ServiceKey))
  key!: ServiceKey;

  @IsIn(Object.values(SecurityPillar))
  pillar!: SecurityPillar;

  @IsString()
  @Length(2, 80)
  titleFa!: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  subtitleFa?: string;

  @IsOptional()
  @IsString()
  @Length(2, 1000)
  descriptionFa?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  iconKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  displayOrder?: number;

  @IsArray()
  @IsIn(Object.values(LocationType))
  supportedLocationTypes!: LocationType[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  baseReadinessScore?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  warrantyMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  typicalDurationMinutes?: number;

  @IsObject()
  uiSchema!: Record<string, unknown>;

  @IsObject()
  pricingSchema!: Record<string, unknown>;
}

export class UpdateServiceDefinitionDto {
  @IsOptional()
  @IsIn(Object.values(SecurityPillar))
  pillar?: SecurityPillar;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  titleFa?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  subtitleFa?: string;

  @IsOptional()
  @IsString()
  @Length(2, 1000)
  descriptionFa?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  iconKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  displayOrder?: number;

  @IsOptional()
  @IsArray()
  @IsIn(Object.values(LocationType))
  supportedLocationTypes?: LocationType[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  baseReadinessScore?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  warrantyMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  typicalDurationMinutes?: number;

  @IsOptional()
  @IsObject()
  uiSchema?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  pricingSchema?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
