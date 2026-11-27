import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PropertyAssetKind, PropertyType } from '@prisma/client';

export class CreatePropertyDto {
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @IsString()
  @Length(2, 120)
  title!: string;

  @IsIn(Object.values(PropertyType))
  propertyType!: PropertyType;

  @IsString()
  @Length(5, 500)
  address!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;

  @IsOptional()
  @IsObject()
  defaultDimensionsJson?: Record<string, unknown>;
}

export class UpdatePropertyDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  cityId?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  title?: string;

  @IsOptional()
  @IsIn(Object.values(PropertyType))
  propertyType?: PropertyType;

  @IsOptional()
  @IsString()
  @Length(5, 500)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, 1000)
  notes?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  defaultDimensionsJson?: Record<string, unknown> | null;
}

export class PresignPropertyMediaDto {
  @IsIn(Object.values(PropertyAssetKind))
  kind!: PropertyAssetKind;

  @IsString()
  @Length(3, 120)
  mimeType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  fileName?: string;
}

export class CompletePropertyMediaDto {
  @IsOptional()
  @IsObject()
  spatialMetadataJson?: Record<string, unknown>;
}
